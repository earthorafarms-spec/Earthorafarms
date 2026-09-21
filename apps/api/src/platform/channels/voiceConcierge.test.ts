import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../config.js', () => ({ config: { RESEND_API_KEY: 'synthetic-configured', ADMIN_NOTIFY_EMAIL: 'team@example.invalid' } }));
const db = vi.hoisted(() => ({ begin: vi.fn() }));
vi.mock('../../db/client.js', () => ({ sql: db }));
import { config } from '../../config.js';
import { explicitRequestConfirmation, normalizeRequestPhone, runRequestTool, validatedRequestField } from './voiceConcierge.js';

const requestId = '00000000-0000-4000-8000-000000000003';
const context = { tenantId: 'tenant', conversationId: 'conversation' };
const token = 'a'.repeat(48);
let draft: any;
let latestUser: { seq: number; content: string };
let writes: { query: string; values: unknown[] }[];
let failOutbox: boolean;
let committed: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  config.RESEND_API_KEY = 'synthetic-configured';
  latestUser = { seq: 12, content: 'Yes, submit it.' };
  writes = []; failOutbox = false; committed = false;
  draft = { id: requestId, request_type: 'contact', fields: { name: 'Synthetic Test', email: 'synthetic@example.invalid', phone: '', topic: 'Wholesale enquiry', message: 'Synthetic request, no delivery.', marketingConsent: false }, revision: 4, status: 'draft', confirmation_hash: createHash('sha256').update(token).digest('hex'), review_user_seq: 11, review_expires_at: new Date(Date.now() + 60000).toISOString() };
  const tx: any = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim();
    if (query.startsWith('SELECT id FROM conversations')) return [{ id: context.conversationId }];
    if (query.startsWith('SELECT * FROM voice_request_drafts')) {
      expect(values).toContain(context.tenantId); expect(values).toContain(context.conversationId);
      return draft ? [draft] : [];
    }
    if (query.startsWith('SELECT seq,content')) return [latestUser];
    writes.push({ query, values });
    if (query.startsWith('INSERT INTO "Contact_details"')) return [{ id: 42 }];
    if (query.startsWith('INSERT INTO escalations')) return [{ id: 'synthetic-escalation' }];
    if (query.startsWith('INSERT INTO jobs')) {
      if (failOutbox) throw new Error('synthetic outbox failure');
      return [{ id: 'synthetic-job' }];
    }
    if (query.startsWith('UPDATE voice_request_drafts SET fields=')) {
      draft = { ...draft, fields: values[0], revision: draft.revision + 1, confirmation_hash: null, review_user_seq: null, review_expires_at: null };
      return [draft];
    }
    if (query.startsWith('UPDATE voice_request_drafts SET confirmation_hash=')) {
      draft.confirmation_hash = values[0]; draft.review_user_seq = values[1];
    }
    if (query.startsWith("UPDATE voice_request_drafts SET status='submitted'")) {
      draft.status = 'submitted'; draft.result = values[0];
    }
    return [];
  });
  tx.json = (value: unknown) => value;
  db.begin.mockImplementation(async work => {
    const previous = structuredClone(draft);
    try { const result = await work(tx); committed = true; return result; }
    catch (error) { draft = previous; throw error; }
  });
});

describe('spoken form validation and confirmation', () => {
  it.each(['yes', 'Yes, submit it.', 'Yes, please submit it.', 'Please send the request', 'हाँ', 'हाँ भेज दीजिए', 'હા', 'હા મોકલી દો'])('accepts an unambiguous confirmation %s', text => expect(explicitRequestConfirmation(text)).toBe(true));
  it.each(['no', 'not yet', 'yes but change my email', 'हाँ नहीं भेजना', 'હા પણ નામ બદલો', 'what happens if I say yes', 'yes please buy two', 'send it tomorrow'])('does not infer permission from %s', text => expect(explicitRequestConfirmation(text)).toBe(false));
  it.each(['98765 43210', '९८७६५४३२१०', '૯૮૭૬૫૪૩૨૧૦', '0091 98765 43210'])('normalizes spoken digit script %s', text => expect(normalizeRequestPhone(text)).toBe('+919876543210'));
  it.each(['123', 'zero nine', '+01987654321', '0000000000'])('rejects invalid phone %s', text => expect(normalizeRequestPhone(text)).toBeNull());
  it('keeps caller data verbatim and marketing opt-in separate', () => {
    expect(validatedRequestField('contact', 'name', '  કૃપા પટેલ  ')).toEqual({ value: 'કૃપા પટેલ' });
    expect(validatedRequestField('contact', 'marketingConsent', 'no')).toEqual({ value: false });
    expect(validatedRequestField('contact', 'marketingConsent', 'maybe')).toHaveProperty('error');
    expect(validatedRequestField('callback', 'email', 'synthetic@example.invalid')).toHaveProperty('error');
    expect(validatedRequestField('contact', 'email', 'a at example')).toHaveProperty('error');
    expect(validatedRequestField('contact', 'message', '<script>alert(1)</script>')).toHaveProperty('error');
    expect(validatedRequestField('contact', 'phone', '')).toEqual({ value: '' });
  });
});

describe('durable request transaction', () => {
  const submit = () => runRequestTool('submit_request', { request_id: requestId, confirmation_token: token }, context);
  it('atomically writes existing contact table, stable outbox and durable result, then deduplicates even outside the HTTP queue', async () => {
    const result = await submit();
    expect(result).toMatchObject({ ok: true, data: { recorded: true, notification_queued: true, notification_status: 'queued', record_id: '42' } });
    expect(committed).toBe(true);
    expect(writes.filter(w => w.query.startsWith('INSERT INTO "Contact_details"'))).toHaveLength(1);
    const job = writes.find(w => w.query.startsWith('INSERT INTO jobs'))!;
    expect(job.values).toContain('contact_email'); expect(job.values).toContain('voice-request:' + requestId);
    expect(job.values[1]).toMatchObject({ marketingConsent: false, topic: 'Wholesale enquiry' });
    latestUser.content = 'Something else';
    expect(await submit()).toMatchObject({ ok: true, data: { already_submitted: true } });
    expect(writes.filter(w => w.query.startsWith('INSERT INTO jobs'))).toHaveLength(1);
  });
  it('uses the existing callback and team notification pipeline', async () => {
    draft.request_type = 'callback'; draft.fields = { name: 'Synthetic', phone: '+919876543210', reason: 'Wholesale discussion' };
    expect(await submit()).toMatchObject({ ok: true, data: { record_id: 'synthetic-escalation' } });
    expect(writes.some(w => w.query.startsWith('INSERT INTO escalations'))).toBe(true);
    expect(writes.find(w => w.query.startsWith('INSERT INTO jobs'))?.values).toContain('escalation_notify');
    expect(writes.some(w => w.query.startsWith('UPDATE conversations SET needs_follow_up'))).toBe(true);
  });
  it('does not commit a record when outbox insertion fails', async () => {
    failOutbox = true;
    await expect(submit()).rejects.toThrow('synthetic outbox failure');
    expect(committed).toBe(false); expect(draft.status).toBe('draft');
  });
  it('requires review followed by a later explicit visitor turn', async () => {
    latestUser.seq = 11; expect(await submit()).toMatchObject({ ok: false });
    latestUser.seq = 12; latestUser.content = 'yes but change the phone'; expect(await submit()).toMatchObject({ ok: false });
    expect(writes).toHaveLength(0);
  });
  it('invalidates confirmation on any field correction', async () => {
    await runRequestTool('set_request_field', { request_id: requestId, field: 'message', value: 'Corrected synthetic request' }, context);
    expect(draft.confirmation_hash).toBeNull();
    expect(await submit()).toMatchObject({ ok: false });
    expect(writes.some(w => w.query.startsWith('INSERT INTO jobs'))).toBe(false);
  });
  it('requires all fields and does not synthesize contact information', async () => {
    delete draft.fields.email;
    expect(await submit()).toMatchObject({ ok: false, data: { missing_fields: ['email'], next_field: 'email' } });
    expect(writes).toHaveLength(0);
  });
  it('returns an exact review snapshot without submitting or notification', async () => {
    const result = await runRequestTool('review_request', { request_id: requestId }, context);
    expect(result).toMatchObject({ ok: true, data: { fields: { name: 'Synthetic Test', marketingConsent: false }, confirmation_token: expect.stringMatching(/^[a-f0-9]{48}$/) } });
    expect(writes).toHaveLength(1); expect(writes[0].query).toContain('review_user_seq');
  });
  it('rejects expired review, cross-session request, unknown tools and unconfigured team delivery', async () => {
    draft.review_expires_at = '2000-01-01'; expect(await submit()).toMatchObject({ ok: false });
    draft.review_expires_at = new Date(Date.now() + 60000).toISOString(); config.RESEND_API_KEY = '';
    expect(await submit()).toMatchObject({ ok: false, message: expect.stringContaining('unavailable') });
    draft = null; expect(await submit()).toMatchObject({ ok: false, message: expect.stringContaining('not found') });
    expect(await runRequestTool('exec_shell', {}, context)).toMatchObject({ ok: false });
    expect(writes).toHaveLength(0);
  });
});
