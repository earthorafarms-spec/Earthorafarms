import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ db: Object.assign(vi.fn(), { begin: vi.fn() }), handlers: new Map<string, any>() }));
vi.mock('../db/client.js', () => ({ sql: boundary.db }));
vi.mock('../config.js', () => ({ config: { RESEND_API_KEY: 'synthetic', RESEND_FROM_EMAIL: 'test@example.invalid', ADMIN_NOTIFY_EMAIL: 'team@example.invalid', PUBLIC_CONSOLE_URL: 'https://console.example.invalid' } }));
vi.mock('../modules/jobs/worker.js', () => ({ registerJobHandler: (name: string, fn: unknown) => boundary.handlers.set(name, fn), registerSchedule: vi.fn() }));
vi.mock('../modules/jobs/queue.js', () => ({ enqueueJob: vi.fn() }));
vi.mock('../modules/commerce/orders.js', () => ({ getOrderBundle: vi.fn() }));
vi.mock('../modules/notifications/invoice.js', () => ({ renderInvoiceForOrder: vi.fn() }));
vi.mock('../platform/providers/index.js', () => ({ getEmbedding: vi.fn() }));
vi.mock('../platform/kb/ingest.js', () => ({ crawlWebsite: vi.fn(), ingestFile: vi.fn(), syncProductDocuments: vi.fn(), tenantId: vi.fn() }));
vi.mock('./assets.js', () => ({ localAssetPath: vi.fn() }));
vi.mock('./crypto.js', () => ({ signPayload: vi.fn() }));

import { config } from '../config.js';
import { sendEmail } from './email.js';
import { sendStudioEmail } from './studioEmail.js';
import { registerNotificationJobs } from '../modules/notifications/handlers.js';
import { registerPlatformJobs } from '../platform/jobs.js';

type Row = { fingerprint: string; status: string; provider_id: string | null; first: number; lease: string | null; until: number };
let receipts: Map<string, Row>;
let timestamp: number;
let sends: { key?: string; body: any }[];
let failPersist: boolean;
let transaction: Promise<unknown>;
const identity = 'studio-request:synthetic-tenant:' + 'a'.repeat(32);
const email = { to: 'synthetic@example.invalid', kind: 'test', subject: 'Synthetic request', html: '<p>Synthetic only</p>' };
const response = (id: string) => new Response(JSON.stringify({ id }), { status: 200 });

beforeEach(() => {
  receipts = new Map(); timestamp = 1000000; sends = []; failPersist = false; transaction = Promise.resolve();
  config.RESEND_API_KEY = 'synthetic'; boundary.handlers.clear();
  boundary.db.mockImplementation(async (strings: TemplateStringsArray, ...v: any[]) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim();
    if (query.startsWith('SELECT pg_advisory')) return [];
    if (query.startsWith('SELECT fingerprint')) {
      const row = receipts.get(v[0]);
      return row ? [{ ...row, expired: timestamp - row.first > (23 * 60 + 55) * 60000, leased: row.until > timestamp }] : [];
    }
    if (query.startsWith('INSERT INTO studio_email_receipts')) {
      expect(receipts.has(v[0])).toBe(false);
      receipts.set(v[0], { fingerprint: v[1], status: 'sending', provider_id: null, first: timestamp, lease: v[2], until: timestamp + 60000 }); return [];
    }
    if (query.startsWith("UPDATE studio_email_receipts SET status='sent'")) {
      if (failPersist) { failPersist = false; throw new Error('Synthetic receipt persistence failure'); }
      const row = receipts.get(v[1]);
      if (row?.fingerprint === v[2]) Object.assign(row, { status: 'sent', provider_id: v[0], lease: null, until: 0 }); return [];
    }
    if (query.startsWith("UPDATE studio_email_receipts SET status='uncertain'")) {
      Object.assign(receipts.get(v[0])!, { status: 'uncertain', lease: null, until: 0 }); return [];
    }
    if (query.startsWith('UPDATE studio_email_receipts SET lease_token=NULL')) {
      const row = receipts.get(v[0]);
      if (row?.lease === v[1] && row.status === 'sending') Object.assign(row, { lease: null, until: 0 }); return [];
    }
    if (query.startsWith('UPDATE studio_email_receipts SET lease_token=')) {
      Object.assign(receipts.get(v[1])!, { lease: v[0], until: timestamp + 60000 }); return [];
    }
    if (query.startsWith('INSERT INTO email_log')) return [];
    throw new Error('Unhandled synthetic query: ' + query);
  });
  boundary.db.begin.mockImplementation((work: any) => {
    const result = transaction.then(() => work(boundary.db));
    transaction = result.catch(() => undefined); return result;
  });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    sends.push({ key: init.headers['Idempotency-Key'], body: JSON.parse(init.body) });
    return response('email-' + sends.length);
  }));
  registerNotificationJobs(); registerPlatformJobs();
});
afterEach(() => vi.unstubAllGlobals());

describe('Studio notification receipts', () => {
  it('resumes only the failed contact notice after a successful visitor acknowledgement', async () => {
    const job = { dedupe_key: identity, payload: { name: 'Synthetic Visitor', email: 'visitor@example.invalid', topic: 'Enquiry', message: 'Synthetic only', marketingConsent: false } };
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const result = await original(url, init);
      const body = JSON.parse(init!.body as string);
      return body.to[0] === 'team@example.invalid' && sends.filter(send => send.body.to[0] === 'team@example.invalid').length === 1
        ? new Response('synthetic failure', { status: 503 }) : result;
    }));
    const contact = boundary.handlers.get('contact_email');
    await expect(contact(job)).rejects.toThrow('did not complete');
    expect(await contact(job)).toEqual({ ack: 'email-1', notice: 'email-3' });
    expect(sends).toHaveLength(3);
    expect(sends[1].key).toBe(sends[2].key); expect(sends[0].key).not.toBe(sends[1].key);
    expect(sends[0].body.html).toContain('Our team will review your request.');
    expect(sends[0].body.html).not.toContain('one working day');
    expect([...receipts.values()].every(row => row.status === 'sent')).toBe(true);
  });

  it('still notifies the team when the visitor acknowledgement fails, then retries only acknowledgement', async () => {
    const job = { dedupe_key: identity, payload: { name: 'Synthetic', email: 'visitor@example.invalid', topic: 'Enquiry', message: 'Synthetic only' } };
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const result = await original(url, init);
      const body = JSON.parse(init!.body as string);
      return body.to[0] === 'visitor@example.invalid' && sends.filter(send => send.body.to[0] === 'visitor@example.invalid').length === 1
        ? new Response('synthetic mailbox rejection', { status: 422 }) : result;
    }));
    const contact = boundary.handlers.get('contact_email');
    await expect(contact(job)).rejects.toThrow('did not complete');
    expect(sends.map(send => send.body.to[0])).toEqual(['visitor@example.invalid', 'team@example.invalid']);
    expect([...receipts.values()].filter(row => row.status === 'sent')).toHaveLength(1);
    expect(await contact(job)).toEqual({ ack: 'email-3', notice: 'email-2' });
    expect(sends.map(send => send.body.to[0])).toEqual(['visitor@example.invalid', 'team@example.invalid', 'visitor@example.invalid']);
    expect(sends[0].key).toBe(sends[2].key);
  });

  it('preserves an uncertain acknowledgement marker while allowing independent team delivery', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Synthetic timeout'); }));
    // Use the actual handler once to create both receipts, then leave one provider-confirmed.
    const job = { dedupe_key: identity, payload: { name: 'Synthetic', email: 'visitor@example.invalid', topic: 'Enquiry', message: 'Synthetic only' } };
    const contact = boundary.handlers.get('contact_email');
    await expect(contact(job)).rejects.toThrow('did not complete');
    const notice = [...receipts.values()][1];
    Object.assign(notice, { status: 'sent', provider_id: 'confirmed-notice' });
    timestamp += 24 * 60 * 60 * 1000;
    await expect(contact(job)).rejects.toMatchObject({ uncertain: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(notice.provider_id).toBe('confirmed-notice');
  });

  it('keeps the exact key and payload after acceptance with a lost response', async () => {
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      await original(url, init);
      if (sends.length === 1) throw new Error('provider echoed synthetic visitor data');
      return response('provider-cached-original');
    }));
    await expect(sendStudioEmail(identity, 'ack', email)).rejects.toThrow('Studio email attempt did not complete');
    const first = [...receipts.values()][0].first;
    expect(await sendStudioEmail(identity, 'ack', email)).toBe('provider-cached-original');
    expect(sends[0]).toEqual(sends[1]); expect([...receipts.values()][0].first).toBe(first);
    expect(sends[0].key?.length).toBeLessThanOrEqual(256);
  });

  it('recovers a provider success followed by a failed receipt write without changing send identity', async () => {
    failPersist = true;
    await expect(sendStudioEmail(identity, 'notice', email)).rejects.toThrow('did not complete');
    expect([...receipts.values()][0].provider_id).toBeNull();
    await sendStudioEmail(identity, 'notice', email);
    expect(sends[0]).toEqual(sends[1]);
    expect([...receipts.values()][0].status).toBe('sent');
  });

  it('stops an uncertain attempt before the provider cache expires, including manual retries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Synthetic timeout'); }));
    await expect(sendStudioEmail(identity, 'ack', email)).rejects.toThrow('did not complete');
    timestamp += 24 * 60 * 60 * 1000;
    await expect(sendStudioEmail(identity, 'ack', email)).rejects.toMatchObject({ uncertain: true });
    await expect(sendStudioEmail(identity, 'ack', email)).rejects.toMatchObject({ uncertain: true });
    expect(fetch).toHaveBeenCalledTimes(1); expect([...receipts.values()][0].status).toBe('uncertain');
  });

  it('returns a persisted provider receipt even after the cache window', async () => {
    const id = await sendStudioEmail(identity, 'ack', email);
    timestamp += 3 * 24 * 60 * 60 * 1000;
    expect(await sendStudioEmail(identity, 'ack', email)).toBe(id); expect(sends).toHaveLength(1);
  });

  it('rejects changed payloads for an existing send identity', async () => {
    await sendStudioEmail(identity, 'ack', email);
    await expect(sendStudioEmail(identity, 'ack', { ...email, to: 'changed@example.invalid' })).rejects.toMatchObject({ uncertain: true });
    expect(sends).toHaveLength(1);
  });

  it('admits one consumer while the committed send lease is active', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const sending = new Promise<void>(resolve => { entered = resolve; });
    vi.stubGlobal('fetch', vi.fn(async () => { entered(); await pending; return response('one-send'); }));
    const first = sendStudioEmail(identity, 'ack', email);
    await sending;
    await expect(sendStudioEmail(identity, 'ack', email)).rejects.toThrow('already being delivered');
    release(); expect(await first).toBe('one-send'); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('protects callback notifications and uses a separate message-part key', async () => {
    const job = { dedupe_key: identity, payload: { conversationId: 'synthetic', contact: { name: 'Synthetic', phone: '+919876543210' }, reason: 'Synthetic callback' } };
    const callback = boundary.handlers.get('escalation_notify');
    expect(await callback(job)).toEqual({ emailId: 'email-1' });
    expect(await callback(job)).toEqual({ emailId: 'email-1' });
    expect(sends).toHaveLength(1);
    await sendStudioEmail(identity, 'ack', email);
    expect(sends[0].key).not.toBe(sends[1].key);
  });

  it('keeps legacy contact emails unchanged and outside Studio receipts', async () => {
    await boundary.handlers.get('contact_email')({ dedupe_key: null, payload: { name: 'Synthetic', email: 'legacy@example.invalid', topic: 'Legacy', message: 'Synthetic' } });
    expect(sends).toHaveLength(2); expect(sends.every(send => !send.key)).toBe(true);
    expect(sends[0].body.html).toContain('one working day'); expect(receipts.size).toBe(0);
  });

  it('does not create attempted receipts when the provider is unconfigured', async () => {
    config.RESEND_API_KEY = '';
    await expect(sendStudioEmail(identity, 'ack', email)).rejects.toThrow('unavailable');
    expect(receipts.size).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });

  it('requires an actual provider identifier before a Studio message is marked sent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await expect(sendStudioEmail(identity, 'ack', email)).rejects.toThrow('did not complete');
    expect([...receipts.values()][0].status).toBe('sending');
  });

  it('validates optional provider keys before sending', async () => {
    await expect(sendEmail({ ...email, idempotencyKey: 'x'.repeat(257) })).rejects.toThrow('Invalid email idempotency key');
    await expect(sendEmail({ ...email, idempotencyKey: 'bad\r\nheader' })).rejects.toThrow('Invalid email idempotency key');
    expect(fetch).not.toHaveBeenCalled();
  });
});
