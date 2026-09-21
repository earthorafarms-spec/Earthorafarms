/** Voice-only form collection. No model inference and no direct notification send. */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sql, type Tx } from '../../db/client.js';
import { config } from '../../config.js';
import type { ToolDef } from '../providers/types.js';

type RequestType = 'contact' | 'callback';
type Fields = Record<string, string | boolean>;
interface Draft { id: string; request_type: RequestType; fields: Fields; revision: number; status: string; confirmation_hash?: string; review_user_seq?: number; review_expires_at?: string; result?: Record<string, unknown> }
export interface RequestContext { tenantId: string; conversationId: string }
const id = z.string().uuid();
const schemas = {
  start_request: z.object({ request_type: z.enum(['contact', 'callback']) }).strict(),
  set_request_field: z.object({ request_id: id, field: z.string().min(1).max(30), value: z.string().max(4000) }).strict(),
  review_request: z.object({ request_id: id }).strict(),
  submit_request: z.object({ request_id: id, confirmation_token: z.string().regex(/^[a-f0-9]{48}$/) }).strict(),
};
export const requestToolNames = Object.keys(schemas);
const fieldsByType = {
  contact: { required: ['name', 'email', 'message'], optional: ['phone', 'topic', 'marketingConsent'] },
  callback: { required: ['name', 'phone', 'reason'], optional: [] },
};
const stringParameter = { type: 'string' };
export const requestTools: ToolDef[] = [
  { name: 'start_request', description: 'Start/resume a contact enquiry (including wholesale/order support) or callback. Returns fields and next missing field. Collect the visitor’s own details one at a time; never invent values.', parameters: { type: 'object', properties: { request_type: { type: 'string', enum: ['contact', 'callback'] } }, required: ['request_type'], additionalProperties: false } },
  { name: 'set_request_field', description: 'Save one spoken form field. Preserve names/email/message, confirm uncertain spelling/digits. marketingConsent must be an explicit yes/no; default false. Returns validation and missing_fields.', parameters: { type: 'object', properties: { request_id: stringParameter, field: { type: 'string', enum: ['name', 'email', 'phone', 'topic', 'message', 'marketingConsent', 'reason'] }, value: stringParameter }, required: ['request_id', 'field', 'value'], additionalProperties: false } },
  { name: 'review_request', description: 'Prepare the completed request summary. Read the exact details and ask whether to submit to the team. Wait for a NEW explicit yes before submit_request. Changes invalidate confirmation.', parameters: { type: 'object', properties: { request_id: stringParameter }, required: ['request_id'], additionalProperties: false } },
  { name: 'submit_request', description: 'Submit the reviewed request only after the visitor explicitly confirms in a new turn. Reuse the review token. Success means recorded and team notification queued, not delivered. Never use for orders/payments/reviews.', parameters: { type: 'object', properties: { request_id: stringParameter, confirmation_token: stringParameter }, required: ['request_id', 'confirmation_token'], additionalProperties: false } },
];

export function normalizeRequestPhone(value: string): string | null {
  let phone = value.trim().replace(/[०-९૦-૯]/g, digit => String(digit.charCodeAt(0) - (digit >= '૦' ? 0x0ae6 : 0x0966)));
  if (!/^[+\d\s().-]+$/.test(phone)) return null;
  phone = phone.replace(/[\s().-]/g, '');
  if (phone.startsWith('00')) phone = '+' + phone.slice(2);
  if (/^0[1-9]\d{9}$/.test(phone)) phone = phone.slice(1);
  if (/^[1-9]\d{9}$/.test(phone)) phone = '+91' + phone;
  else if (/^91[1-9]\d{9}$/.test(phone)) phone = '+' + phone;
  return /^\+[1-9]\d{7,14}$/.test(phone) && (!phone.startsWith('+91') || /^\+91[1-9]\d{9}$/.test(phone)) ? phone : null;
}

export function validatedRequestField(type: RequestType, field: string, input: string): { value: string | boolean } | { error: string } {
  const allowed = [...fieldsByType[type].required, ...fieldsByType[type].optional];
  if (!allowed.includes(field)) return { error: 'This field does not belong to the request.' };
  const value = input.trim();
  if (/<\s*[a-z!\/]|javascript:|on\w+\s*=/i.test(value)) return { error: 'Please use plain text without HTML or scripts.' };
  if (field === 'marketingConsent') {
    if (/^(?:true|yes|हाँ|हां|હા)$/i.test(value)) return { value: true };
    if (/^(?:false|no|नहीं|ના)$/i.test(value)) return { value: false };
    return { error: 'Ask whether marketing updates are wanted; use an explicit yes or no.' };
  }
  if (field === 'phone') {
    if (!value && type === 'contact') return { value: '' };
    const phone = normalizeRequestPhone(value);
    return phone ? { value: phone } : { error: 'Ask for a valid phone number, including country code outside India.' };
  }
  if (field === 'email') return z.string().email().max(255).safeParse(value).success ? { value } : { error: 'Ask the visitor to spell a valid email address.' };
  const limit = field === 'message' ? 4000 : field === 'reason' ? 2000 : 120;
  if ((!value && fieldsByType[type].required.includes(field)) || value.length > limit) return { error: `This field needs ${fieldsByType[type].required.includes(field) ? '1' : '0'}–${limit} characters.` };
  return { value };
}

export function explicitRequestConfirmation(text: string): boolean {
  const value = text.trim().replace(/[.!?।,]+$/g, '').trim();
  return /^(?:yes(?:[, ]+please)?(?:[, ]+(?:submit|send|confirm)(?: it| this| the request)?)?|(?:please )?(?:submit|send|confirm)(?: it| this| the request)|हाँ|हां|हाँ[, ]+(?:भेज दीजिए|भेज दो|सबमिट कर दीजिए)|हां[, ]+(?:भेज दीजिए|भेज दो)|भेज दीजिए|सबमिट कर दीजिए|હા|હા[, ]+(?:મોકલો|મોકલી દો|સબમિટ કરો)|મોકલી દો|સબમિટ કરો)$/i.test(value);
}

function view(draft: Draft) {
  const missing = fieldsByType[draft.request_type].required.filter(field => !String(draft.fields[field] ?? '').trim());
  return { request_id: draft.id, request_type: draft.request_type, status: draft.status, revision: draft.revision, fields: draft.fields,
    required_fields: fieldsByType[draft.request_type].required, optional_fields: fieldsByType[draft.request_type].optional,
    missing_fields: missing, next_field: missing[0] ?? null, confirmation_required: draft.status === 'draft',
    ...(draft.result ? { submission: draft.result } : {}) };
}

export async function requestDrafts(context: RequestContext) {
  const rows = await sql<Draft[]>`SELECT id,request_type,fields,revision,status,result FROM voice_request_drafts
    WHERE tenant_id=${context.tenantId} AND conversation_id=${context.conversationId} ORDER BY (status='draft') DESC,updated_at DESC LIMIT 2`;
  return rows.map(view);
}

async function latestUser(tx: Tx, conversationId: string) {
  const [message] = await tx<{ seq: number; content: string }[]>`SELECT seq,content FROM messages WHERE conversation_id=${conversationId} AND role='user' ORDER BY seq DESC LIMIT 1`;
  return message;
}

export async function runRequestTool(name: string, args: Record<string, unknown>, context: RequestContext) {
  const schema = schemas[name as keyof typeof schemas];
  const parsed = schema?.safeParse(args);
  if (!parsed?.success) return { ok: false, message: 'Invalid request arguments. Use the current form fields and request id.' };
  const values = parsed.data as Record<string, string>;
  return sql.begin(async tx => {
    // The conversation lock serializes starts and edits across API processes.
    await tx`SELECT id FROM conversations WHERE id=${context.conversationId} AND tenant_id=${context.tenantId} FOR UPDATE`;
    if (name === 'start_request') {
      const type = values.request_type as RequestType;
      let [draft] = await tx<Draft[]>`SELECT * FROM voice_request_drafts WHERE tenant_id=${context.tenantId} AND conversation_id=${context.conversationId} AND request_type=${type} AND status='draft' FOR UPDATE`;
      if (!draft) {
        const fields = type === 'contact' ? { marketingConsent: false, topic: 'General', phone: '' } : {};
        [draft] = await tx<Draft[]>`INSERT INTO voice_request_drafts (tenant_id,conversation_id,request_type,fields)
          VALUES (${context.tenantId},${context.conversationId},${type},${tx.json(fields)}) RETURNING *`;
      }
      return { ok: true, data: view(draft) };
    }
    const [draft] = await tx<Draft[]>`SELECT * FROM voice_request_drafts WHERE id=${values.request_id} AND tenant_id=${context.tenantId} AND conversation_id=${context.conversationId} FOR UPDATE`;
    if (!draft) return { ok: false, message: 'Request not found in this conversation.' };
    if (draft.status === 'submitted') return { ok: true, data: { ...view(draft), ...draft.result, already_submitted: true } };
    if (name === 'set_request_field') {
      const checked = validatedRequestField(draft.request_type, values.field, values.value);
      if ('error' in checked) return { ok: false, data: view(draft), message: checked.error };
      const fields = { ...draft.fields, [values.field]: checked.value };
      const [updated] = await tx<Draft[]>`UPDATE voice_request_drafts SET fields=${tx.json(fields)},revision=revision+1,
        confirmation_hash=NULL,review_user_seq=NULL,review_expires_at=NULL,updated_at=now() WHERE id=${draft.id} RETURNING *`;
      return { ok: true, data: view(updated) };
    }
    const snapshot = view(draft);
    if (snapshot.missing_fields.length) return { ok: false, data: snapshot, message: 'Collect the missing fields before reviewing or submitting.' };
    for (const [field, value] of Object.entries(draft.fields)) {
      const checked = validatedRequestField(draft.request_type, field, String(value));
      if ('error' in checked) return { ok: false, data: snapshot, message: checked.error };
    }
    const user = await latestUser(tx, context.conversationId);
    if (!user) return { ok: false, message: 'A visitor turn is required before request confirmation.' };
    if (name === 'review_request') {
      const token = randomBytes(24).toString('hex');
      const hash = createHash('sha256').update(token).digest('hex');
      await tx`UPDATE voice_request_drafts SET confirmation_hash=${hash},review_user_seq=${user.seq},review_expires_at=now()+interval '10 minutes',updated_at=now() WHERE id=${draft.id}`;
      return { ok: true, data: { request_id: draft.id, request_type: draft.request_type, revision: draft.revision, status: draft.status,
        fields: draft.fields, summary: 'Read the exact fields, including marketing consent, then ask whether to submit.', confirmation_token: token,
        message: 'Read these details to the visitor and ask permission to submit. Wait for a new explicit confirmation turn.' } };
    }
    const hash = createHash('sha256').update(values.confirmation_token).digest('hex');
    if (hash !== draft.confirmation_hash || !draft.review_expires_at || new Date(draft.review_expires_at).getTime() <= Date.now()
        || BigInt(user.seq) <= BigInt(draft.review_user_seq ?? user.seq) || !explicitRequestConfirmation(user.content)) {
      return { ok: false, data: snapshot, message: 'Submission needs a current reviewed summary and a new explicit visitor confirmation. Ask before submitting; corrections require a new review.' };
    }
    if (!config.RESEND_API_KEY || !config.ADMIN_NOTIFY_EMAIL) return { ok: false, message: 'Team email notifications are unavailable. The draft is saved; do not claim submission or delivery.' };
    let recordId: string;
    let kind: string;
    let payload: Record<string, unknown>;
    const d = draft.fields;
    if (draft.request_type === 'contact') {
      const [record] = await tx<{ id: number }[]>`INSERT INTO "Contact_details" (contact_name,contact_email,contact_phone,contact_topic,contact_message,contact_marketing_consent)
        VALUES (${String(d.name)},${String(d.email)},${String(d.phone || '')},${String(d.topic || 'General')},${String(d.message)},${d.marketingConsent === true}) RETURNING id`;
      recordId = String(record.id); kind = 'contact_email';
      payload = { name: d.name, email: d.email, phone: d.phone || '', topic: d.topic || 'General', message: d.message, marketingConsent: d.marketingConsent === true };
    } else {
      const contact = { name: String(d.name), phone: String(d.phone) };
      const [record] = await tx<{ id: string }[]>`INSERT INTO escalations (tenant_id,conversation_id,kind,contact,payload,status)
        VALUES (${context.tenantId},${context.conversationId},'callback',${tx.json(contact)},${tx.json({ reason: d.reason })},'open') RETURNING id`;
      await tx`UPDATE conversations SET needs_follow_up=true,escalated=true WHERE id=${context.conversationId}`;
      recordId = record.id; kind = 'escalation_notify';
      payload = { conversationId: context.conversationId, reason: d.reason, contact };
    }
    const [job] = await tx<{ id: string }[]>`INSERT INTO jobs (kind,payload,dedupe_key) VALUES (${kind},${tx.json(payload as never)},${'voice-request:' + draft.id})
      ON CONFLICT (dedupe_key) DO UPDATE SET updated_at=now() RETURNING id`;
    const result = { request_id: draft.id, request_type: draft.request_type, recorded: true, notification_queued: true, notification_status: 'queued', record_id: recordId, notification_job_id: job.id };
    await tx`UPDATE voice_request_drafts SET status='submitted',result=${tx.json(result)},submitted_at=now(),updated_at=now() WHERE id=${draft.id}`;
    return { ok: true, data: result, message: 'Request recorded and team notification queued. Delivery and response timing are not confirmed.' };
  });
}
