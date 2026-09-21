import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../config.js', () => ({ config: { RESEND_API_KEY: 'synthetic', ADMIN_NOTIFY_EMAIL: 'team@example.invalid' } }));
const db = vi.hoisted(() => ({ begin: vi.fn() }));
vi.mock('../../db/client.js', () => ({ sql: db }));
import { config } from '../../config.js';
import { receiveStudioRequest, studioRequestInput } from './studioRequests.js';

const context = { tenantId: 'tenant', conversationId: 'conversation' };
const sample = () => studioRequestInput.parse({ request_id: 'a'.repeat(32), flow_id: 'wholesale', flow_name: 'Wholesale enquiry', destination: 'earthora_contact', config_revision: 5,
  fields: { name: 'Synthetic Visitor', email: 'synthetic@example.invalid', message: 'Please contact me', cartons: '12', phone: '९८७६५४३२१०' }, field_labels: { cartons: 'Number of cartons' } });
let receipt: any;
let writes: { query: string; values: any[] }[];
let committed: boolean;
let missingConversation: boolean;
let failJob: boolean;
beforeEach(() => {
  receipt = null; writes = []; committed = false; missingConversation = false; failJob = false;
  config.RESEND_API_KEY = 'synthetic';
  const tx: any = async (strings: TemplateStringsArray, ...values: any[]) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim();
    if (query.startsWith('SELECT id FROM conversations')) return missingConversation ? [] : [{ id: context.conversationId }];
    if (query.startsWith('SELECT pg_advisory')) return [];
    if (query.startsWith('SELECT conversation_id')) { expect(values).toEqual([context.tenantId, 'a'.repeat(32)]); return receipt ? [receipt] : []; }
    writes.push({ query, values });
    if (query.startsWith('INSERT INTO "Contact_details"')) return [{ id: 41 }];
    if (query.startsWith('INSERT INTO escalations')) return [{ id: 'callback41' }];
    if (query.startsWith('INSERT INTO jobs')) { if (failJob) throw new Error('outbox unavailable'); return [{ id: 'job41' }]; }
    if (query.startsWith('INSERT INTO studio_voice_requests')) receipt = { conversation_id: values[2], fingerprint: values[3], result: values[7] };
    return [];
  };
  tx.json = (v: any) => v;
  db.begin.mockImplementation(async work => {
    const before = structuredClone(receipt);
    try { const result = await work(tx); committed = true; return result; }
    catch (error) { receipt = before; throw error; }
  });
});

describe('Studio configurable enquiry delivery', () => {
  it('preserves custom fields and queues the existing contact handler atomically', async () => {
    expect(await receiveStudioRequest(sample(), context)).toMatchObject({ ok: true, data: { recorded: true, notification_queued: true, status: 'queued', external_id: '41' } });
    const contact = writes.find(w => w.query.startsWith('INSERT INTO "Contact_details"'))!;
    expect(contact.values).toContain('Please contact me\n\nAdditional details:\nNumber of cartons: 12');
    expect(contact.values).toContain('+919876543210'); expect(contact.query).toContain(',false)');
    expect(writes.find(w => w.query.startsWith('INSERT INTO jobs'))!.values).toContain('studio-request:tenant:' + 'a'.repeat(32));
    expect(receipt).not.toBeNull(); expect(committed).toBe(true);
  });
  it('deduplicates retries and rejects cross-conversation or changed payload replay', async () => {
    const result = await receiveStudioRequest(sample(), context);
    const count = writes.length;
    expect(await receiveStudioRequest({ ...sample(), fields: Object.fromEntries(Object.entries(sample().fields).reverse()) }, context)).toEqual(result);
    expect(writes).toHaveLength(count);
    expect(await receiveStudioRequest({ ...sample(), flow_name: 'Changed' }, context)).toMatchObject({ ok: false });
    expect(await receiveStudioRequest(sample(), { ...context, conversationId: 'another' })).toMatchObject({ ok: false });
    expect(writes).toHaveLength(count);
  });
  it('routes callbacks with extra details through existing follow-up and notification jobs', async () => {
    const input = { ...sample(), destination: 'earthora_callback' as const, fields: { name: 'Synthetic', phone: '9876543210', reason: 'Prices', city: 'Ahmedabad' }, field_labels: { city: 'City' } };
    expect(await receiveStudioRequest(input, context)).toMatchObject({ ok: true, data: { external_id: 'callback41' } });
    const job = writes.find(w => w.query.startsWith('INSERT INTO jobs'))!;
    expect(job.values[0]).toBe('escalation_notify'); expect(job.values[1].reason).toContain('City: Ahmedabad');
    expect(writes.some(w => w.query.includes('needs_follow_up=true'))).toBe(true);
  });
  it('rolls back all writes in explicit validation mode and on outbox failure', async () => {
    expect(await receiveStudioRequest({ ...sample(), validate_only: true }, context)).toEqual({ ok: true, data: { validated: true, recorded: false, notification_queued: false } });
    expect(committed).toBe(false); expect(receipt).toBeNull();
    failJob = true;
    await expect(receiveStudioRequest(sample(), context)).rejects.toThrow('outbox unavailable');
    expect(receipt).toBeNull(); expect(committed).toBe(false);
  });
  it('rejects unavailable notification settings or mismatched tenant before writes', async () => {
    config.RESEND_API_KEY = '';
    expect(await receiveStudioRequest(sample(), context)).toMatchObject({ ok: false });
    config.RESEND_API_KEY = 'synthetic'; missingConversation = true;
    expect(await receiveStudioRequest(sample(), context)).toMatchObject({ ok: false });
    expect(writes).toHaveLength(0);
  });
  it.each([
    { fields: { name: 'Synthetic', message: 'No email' } },
    { fields: { ...sample().fields, phone: '123' } },
    { destination: 'arbitrary_url' },
    { fields: { ...sample().fields, message: '<script>bad</script>' } },
    { fields: { ...sample().fields, name: 'x'.repeat(121) } },
  ])('rejects malformed destination or sink data %#', async patch => {
    expect(await receiveStudioRequest({ ...sample(), ...patch } as any, context)).toMatchObject({ ok: false });
    expect(writes).toHaveLength(0);
  });
});
