/** Authenticated Studio delivery boundary. Collection and consent live in Studio. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../../db/client.js';
import { config } from '../../config.js';
import { normalizeRequestPhone, type RequestContext } from './voiceConcierge.js';

const key = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/);
const plain = (max: number) => z.string().max(max).refine(v => !/<\s*[a-z!\/]|javascript:/i.test(v), 'Use plain text');
export const studioRequestInput = z.object({
  request_id: z.string().regex(/^[a-f0-9]{32}$/),
  flow_id: z.string().regex(/^[a-z][a-z0-9_-]{0,60}$/),
  flow_name: plain(120).refine(v => v.trim().length > 0, 'Flow name required'),
  destination: z.enum(['earthora_contact', 'earthora_callback']),
  fields: z.record(key, plain(2000)),
  field_labels: z.record(key, plain(100)),
  config_revision: z.number().int().positive(),
  validate_only: z.boolean().optional().default(false),
}).strict().superRefine((value, ctx) => {
  const names = Object.keys(value.fields);
  if (names.length > 20 || Object.keys(value.field_labels).length > 20)
    ctx.addIssue({ code: 'custom', message: 'At most 20 fields' });
  const required = value.destination === 'earthora_contact' ? ['name', 'email', 'message'] : ['name', 'phone', 'reason'];
  for (const field of required) if (!value.fields[field]?.trim())
    ctx.addIssue({ code: 'custom', path: ['fields', field], message: 'Required field' });
  if ((value.fields.name || '').length > 120 || (value.fields.topic || '').length > 120)
    ctx.addIssue({ code: 'custom', message: 'Name and topic must be at most 120 characters' });
  if (value.destination === 'earthora_contact' && !z.string().email().max(255).safeParse(value.fields.email).success)
    ctx.addIssue({ code: 'custom', path: ['fields', 'email'], message: 'Valid email required' });
  if (value.fields.phone && !normalizeRequestPhone(value.fields.phone))
    ctx.addIssue({ code: 'custom', path: ['fields', 'phone'], message: 'Valid phone with country code required' });
});

type Input = z.infer<typeof studioRequestInput>;
type Receipt = { conversation_id: string; fingerprint: string; result: Record<string, unknown> };
class ValidationRollback extends Error {}

function fingerprint(data: Input): string {
  // Stable across JSON object ordering and transport retries; include exact values.
  return createHash('sha256').update(JSON.stringify([
    data.flow_id, data.flow_name, data.destination, data.config_revision,
    Object.entries(data.fields).sort(), Object.entries(data.field_labels).sort(),
  ])).digest('hex');
}

export async function receiveStudioRequest(input: Input, context: RequestContext) {
  const checked = studioRequestInput.safeParse(input);
  if (!checked.success) return { ok: false, message: 'Invalid Studio enquiry fields.' };
  const data = checked.data;
  const hash = fingerprint(data);
  try {
    return await sql.begin(async tx => {
      const [conversation] = await tx`SELECT id FROM conversations WHERE id=${context.conversationId} AND tenant_id=${context.tenantId} FOR UPDATE`;
      if (!conversation) return { ok: false, message: 'Conversation unavailable.' };
      // This also serializes malicious/replayed IDs across different conversations.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${context.tenantId + ':' + data.request_id},0))`;
      const [existing] = await tx<Receipt[]>`SELECT conversation_id,fingerprint,result FROM studio_voice_requests WHERE tenant_id=${context.tenantId} AND request_id=${data.request_id}`;
      if (existing) {
        if (existing.conversation_id !== context.conversationId || existing.fingerprint !== hash)
          return { ok: false, message: 'Request identifier conflict.' };
        return { ok: true, data: existing.result };
      }
      if (!config.RESEND_API_KEY || !config.ADMIN_NOTIFY_EMAIL)
        return { ok: false, message: 'Team notifications are unavailable. Studio will retain the pending request.' };
      const d = data.fields;
      const contact = data.destination === 'earthora_contact';
      const mapped = new Set(contact ? ['name', 'email', 'phone', 'message', 'topic'] : ['name', 'phone', 'reason']);
      const extras = Object.entries(d).filter(([k, v]) => !mapped.has(k) && v).map(([k, v]) => `${data.field_labels[k] || k}: ${v}`);
      const message = `${contact ? d.message : d.reason}${extras.length ? '\n\nAdditional details:\n' + extras.join('\n') : ''}`;
      const phone = d.phone ? normalizeRequestPhone(d.phone)! : '';
      let externalId: string;
      let kind: string;
      let payload: Record<string, unknown>;
      if (contact) {
        // A custom field never opts a visitor into marketing without a dedicated consent contract.
        const topic = d.topic || data.flow_name;
        const [row] = await tx<{ id: number }[]>`INSERT INTO "Contact_details" (contact_name,contact_email,contact_phone,contact_topic,contact_message,contact_marketing_consent)
          VALUES (${d.name},${d.email},${phone},${topic},${message},false) RETURNING id`;
        externalId = String(row.id); kind = 'contact_email';
        payload = { name: d.name, email: d.email, phone, topic, message, marketingConsent: false };
      } else {
        const person = { name: d.name, phone };
        const [row] = await tx<{ id: string }[]>`INSERT INTO escalations (tenant_id,conversation_id,kind,contact,payload,status)
          VALUES (${context.tenantId},${context.conversationId},'callback',${tx.json(person)},${tx.json({ reason: message, studio_request_id: data.request_id })},'open') RETURNING id`;
        await tx`UPDATE conversations SET needs_follow_up=true,escalated=true WHERE id=${context.conversationId}`;
        externalId = row.id; kind = 'escalation_notify';
        payload = { conversationId: context.conversationId, reason: message, contact: person };
      }
      const [job] = await tx<{ id: string }[]>`INSERT INTO jobs (kind,payload,dedupe_key)
        VALUES (${kind},${tx.json(payload as never)},${'studio-request:' + context.tenantId + ':' + data.request_id}) RETURNING id`;
      const result = { recorded: true, notification_queued: true, external_id: externalId, status: 'queued', notification_job_id: job.id };
      await tx`INSERT INTO studio_voice_requests (tenant_id,request_id,conversation_id,fingerprint,flow_id,config_revision,fields,result)
        VALUES (${context.tenantId},${data.request_id},${context.conversationId},${hash},${data.flow_id},${data.config_revision},${tx.json(data.fields)},${tx.json(result)})`;
      // Exercises real DB constraints/outbox writes while rolling back every QA row.
      if (data.validate_only) throw new ValidationRollback();
      return { ok: true, data: result };
    });
  } catch (error) {
    if (error instanceof ValidationRollback)
      return { ok: true, data: { validated: true, recorded: false, notification_queued: false } };
    throw error;
  }
}
