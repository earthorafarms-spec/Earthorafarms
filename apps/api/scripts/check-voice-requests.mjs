/** Opt-in PostgreSQL proof: private synthetic schema, no worker and no delivery. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

if (process.env.VOICE_REQUEST_ISOLATED_CHECK !== '1') throw new Error('Explicit isolated check flag required');
const originalUrl = process.env.DATABASE_URL;
if (!originalUrl) throw new Error('Database connection is required');
const schema = 'voice_req_test_' + randomUUID().replaceAll('-', '');
assert.match(schema, /^voice_req_test_[a-f0-9]{32}$/);
const admin = postgres(originalUrl, { max: 1, onnotice: () => {} });
let sql;
let created = false;
try {
  await admin.unsafe(`CREATE SCHEMA "${schema}"`); created = true;
  const scoped = new URL(originalUrl);
  scoped.searchParams.set('search_path', schema); // no public-schema fallback
  process.env.DATABASE_URL = scoped.toString();
  process.env.RESEND_API_KEY = 'synthetic-disabled-delivery';
  process.env.ADMIN_NOTIFY_EMAIL = 'synthetic-team@example.invalid';
  globalThis.fetch = async () => { throw new Error('External delivery/inference forbidden in isolated check'); };
  ({ sql } = await import('../dist/db/client.js'));
  const { runRequestTool } = await import('../dist/platform/channels/voiceConcierge.js');
  const [{ current_schema: actual }] = await sql`SELECT current_schema()`;
  assert.equal(actual, schema);
  await sql.unsafe(`
    CREATE TABLE tenants(id uuid PRIMARY KEY);
    CREATE TABLE conversations(id uuid PRIMARY KEY, tenant_id uuid, needs_follow_up boolean DEFAULT false, escalated boolean DEFAULT false);
    CREATE TABLE messages(seq bigserial PRIMARY KEY,conversation_id uuid,role text,content text);
    CREATE TABLE "Contact_details"(id serial PRIMARY KEY,contact_name text,contact_email text,contact_phone text,contact_topic text,contact_message text,contact_marketing_consent boolean);
    CREATE TABLE escalations(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,tenant_id uuid,conversation_id uuid,kind text,contact jsonb,payload jsonb,status text);
    CREATE TABLE jobs(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,kind text,payload jsonb,dedupe_key text UNIQUE,updated_at timestamptz DEFAULT now(),CONSTRAINT synthetic_failure CHECK (payload->>'message' IS DISTINCT FROM 'FORCE_FAILURE'));
  `);
  await sql.unsafe(await readFile(new URL('../dist/db/migrations/0003_voice_requests.sql', import.meta.url), 'utf8'));
  const tenantId = randomUUID(), conversationId = randomUUID(), otherConversation = randomUUID();
  const ctx = { tenantId, conversationId };
  await sql`INSERT INTO tenants(id) VALUES(${tenantId})`;
  await sql`INSERT INTO conversations(id,tenant_id) VALUES(${conversationId},${tenantId}),(${otherConversation},${tenantId})`;
  const say = text => sql`INSERT INTO messages(conversation_id,role,content) VALUES(${conversationId},'user',${text})`;
  const invoke = (name, args) => runRequestTool(name, args, ctx);
  async function draft(type, fields) {
    await say('Synthetic request; no external delivery.');
    const start = await invoke('start_request', { request_type: type });
    assert.equal(start.ok, true);
    const request_id = start.data.request_id;
    for (const [field, value] of Object.entries(fields)) assert.equal((await invoke('set_request_field', { request_id, field, value })).ok, true);
    return request_id;
  }
  const email = `synthetic-${schema}@example.invalid`;
  const request_id = await draft('contact', { name: 'Synthetic isolated check', email, topic: 'Wholesale', message: 'Isolated synthetic request, no external delivery' });
  const initial = await invoke('review_request', { request_id });
  const first = { request_id, confirmation_token: initial.data.confirmation_token };
  assert.equal((await invoke('submit_request', first)).ok, false, 'same-turn confirmation must fail');
  await say('Yes, but change the message');
  assert.equal((await invoke('submit_request', first)).ok, false, 'ambiguous correction must fail');
  await invoke('set_request_field', { request_id, field: 'message', value: 'Revised isolated synthetic request' });
  await say('Yes');
  assert.equal((await invoke('submit_request', first)).ok, false, 'old review must fail after edit');
  const review = await invoke('review_request', { request_id });
  const submit = { request_id, confirmation_token: review.data.confirmation_token };
  await say('હા મોકલી દો');
  const results = await Promise.all([invoke('submit_request', submit), invoke('submit_request', submit)]);
  assert.ok(results.every(result => result.ok && result.data.recorded));
  assert.equal(results.filter(result => result.data.already_submitted).length, 1);
  assert.equal((await runRequestTool('submit_request', submit, { tenantId, conversationId: otherConversation })).ok, false);
  assert.equal(Number((await sql`SELECT count(*) FROM "Contact_details"`)[0].count), 1);
  assert.equal(Number((await sql`SELECT count(*) FROM jobs WHERE kind='contact_email'`)[0].count), 1);
  assert.equal((await sql`SELECT contact_marketing_consent FROM "Contact_details"`)[0].contact_marketing_consent, false);
  const failedId = await draft('contact', { name: 'Synthetic rollback', email, message: 'FORCE_FAILURE' });
  const failedReview = await invoke('review_request', { request_id: failedId });
  await say('Yes');
  await assert.rejects(() => invoke('submit_request', { request_id: failedId, confirmation_token: failedReview.data.confirmation_token }));
  assert.equal(Number((await sql`SELECT count(*) FROM "Contact_details"`)[0].count), 1, 'failed outbox must roll back contact');
  assert.equal((await sql`SELECT status FROM voice_request_drafts WHERE id=${failedId}`)[0].status, 'draft');
  const callbackId = await draft('callback', { name: 'Synthetic callback', phone: '૯૮૭૬૫૪૩૨૧૦', reason: 'Isolated synthetic callback' });
  const callbackReview = await invoke('review_request', { request_id: callbackId });
  await say('हाँ भेज दीजिए');
  assert.equal((await invoke('submit_request', { request_id: callbackId, confirmation_token: callbackReview.data.confirmation_token })).ok, true);
  assert.equal(Number((await sql`SELECT count(*) FROM escalations`)[0].count), 1);
  assert.equal(Number((await sql`SELECT count(*) FROM jobs WHERE kind='escalation_notify'`)[0].count), 1);
  assert.equal(Number((await admin`SELECT count(*) FROM public."Contact_details" WHERE contact_email=${email}`)[0].count), 0, 'synthetic leads must not reach production');
  console.log(JSON.stringify({ passed: true, isolated_schema: true, contact_and_callback_outboxes: true, durable_retry_and_concurrent_dedupe: true, same_turn_and_correction_rejected: true, rollback_on_outbox_failure: true, cross_conversation_denied: true, marketing_default_false: true, public_test_leads: 0, notifications_sent: 0 }));
} finally {
  if (sql) await sql.end({ timeout: 5 });
  if (created) await admin.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end({ timeout: 5 });
}
