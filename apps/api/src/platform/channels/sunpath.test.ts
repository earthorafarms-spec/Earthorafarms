import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config.js', () => ({ config: { EARTHORA_VOICE_INTERNAL_KEY: 'test-key', VOICE_PHONE_CHANNEL_KEY: 'pk_voice', PII_ENCRYPTION_KEY: 'a'.repeat(64) } }));
vi.mock('../../db/client.js', () => ({ sql: vi.fn() }));
vi.mock('./config.js', () => ({ getChannelByKey: vi.fn(), publishedConfig: (ch: any) => ch.published_config }));
vi.mock('../engine/conversation.js', () => ({ loadConversation: vi.fn(), appendMessage: vi.fn(), saveState: vi.fn() }));
vi.mock('../../modules/commerce/pricing.js', () => ({ listProducts: vi.fn(), priceCart: vi.fn() }));
vi.mock('../kb/retrieve.js', () => ({ retrieve: vi.fn() }));
vi.mock('./voiceConcierge.js', () => ({ requestDrafts: vi.fn(async () => []), requestToolNames: ['start_request', 'set_request_field', 'review_request', 'submit_request'], requestTools: [{ name: 'start_request' }], runRequestTool: vi.fn(async () => ({ ok: true, data: { request_id: 'synthetic' } })) }));
vi.mock('./studioRequests.js', async original => ({ ...(await original<any>()), receiveStudioRequest: vi.fn() }));
const run = vi.hoisted(() => vi.fn());
vi.mock('../engine/functions.js', () => ({
  BUILTIN_MAP: new Map([
    ['list_products', { name: 'list_products', run, parameters: { type: 'object', properties: { query: { type: 'string' } } } }],
    ['capture_callback', { name: 'capture_callback', run, parameters: { type: 'object', properties: { reason: { type: 'string' }, name: { type: 'string' }, phone: { type: 'string' } }, required: ['reason'] } }],
    ['search_knowledge', { name: 'search_knowledge', run, parameters: { type: 'object', properties: { query: { type: 'string' }, productId: { type: 'string' } }, required: ['query'] } }],
    ...['add_to_cart', 'update_cart'].map(name => [name, { name, run, parameters: { type: 'object', properties: { productId: { type: 'string' }, quantity: { type: 'integer', minimum: name === 'add_to_cart' ? 1 : 0 } }, required: ['productId', 'quantity'] } }] as const),
  ]),
  toolDefsFor: (names: string[]) => names.map(name => ({ name })),
}));

import { sunpathRoutes } from './sunpath.js';
import { sql } from '../../db/client.js';
import { getChannelByKey } from './config.js';
import { appendMessage, loadConversation, saveState } from '../engine/conversation.js';
import { inVoiceScope } from '../providers/voiceScope.js';
import { listProducts, priceCart } from '../../modules/commerce/pricing.js';
import { createCheckoutSnapshot } from './voiceCheckout.js';
import { retrieve } from '../kb/retrieve.js';
import { receiveStudioRequest } from './studioRequests.js';

const common = { session_id: 'voice_test', channel_key: 'pk_voice', channel: 'web' };
const headers = { authorization: 'Bearer test-key' };
const servers: ReturnType<typeof Fastify>[] = [];
async function server() { const app = Fastify(); await app.register(sunpathRoutes); servers.push(app); return app; }
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listProducts).mockResolvedValue([{ id: 'product1', name: 'Product', slug: 'product', status: 'active' }] as any);
  vi.mocked(getChannelByKey).mockResolvedValue({ id: 'channel1', tenant_id: 'tenant1', type: 'voice', enabled: true, public_key: 'pk_voice', published_config: { name: 'Eva' } } as any);
  vi.mocked(loadConversation).mockResolvedValue({ id: 'conv1', history: [], contact: {}, state: { slots: {}, cart: [], checkout: { phone: '9876543210' }, summary: '', language: 'en' } });
  vi.mocked(sql).mockImplementation(((strings: TemplateStringsArray) => Promise.resolve(strings.join('').includes('FROM product_knowledge') ? [] : [{ title: 'Approved info', text: 'Earthora product information.' }])) as any);
  vi.mocked(retrieve).mockResolvedValue([]);
  run.mockImplementation(async () => { expect(inVoiceScope()).toBe(true); return { ok: true, data: [{ id: 'product1', name: 'Product', price: 10 }] }; });
});
afterEach(async () => { await Promise.all(servers.splice(0).map(app => app.close())); });

describe('SunPath-style worker data boundary', () => {
  it('serves encrypted checkout tokens longer than the router named-parameter limit', async () => {
    const app = await server();
    const customer = {name:'Synthetic Visitor',email:'test@example.invalid',phone:'+12025550100',address:'Synthetic Road 12',city:'Ahmedabad',state:'Gujarat',zip:'380015',country:'India'};
    const token = createCheckoutSnapshot('test-review','en',customer,[{productId:'product1',quantity:1}]);
    expect(token.length).toBeGreaterThan(100);
    vi.mocked(priceCart).mockResolvedValue({lines:[{productId:'product1',quantity:1}],subtotal:10,total:10,unavailable:[],outOfStock:[]} as any);
    const response = await app.inject({url:'/platform/voice/checkout/'+token});
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.json().customer).toEqual(customer);
    expect(sql).not.toHaveBeenCalled();expect(saveState).not.toHaveBeenCalled();
    expect((await app.inject({url:'/platform/voice/checkout/'+token+'/extra'})).statusCode).toBe(404);
  });
  it('rejects unauthenticated access before any data load', async () => {
    const app = await server();
    for (const path of ['context', 'tool', 'record', 'flow-request']) expect((await app.inject({ method: 'POST', url: `/platform/voice/internal/${path}`, payload: common })).statusCode).toBe(401);
    expect(loadConversation).not.toHaveBeenCalled(); expect(sql).not.toHaveBeenCalled();
  });
  it('routes Studio delivery only through authenticated channel and conversation resolution', async () => {
    const app = await server();
    const payload = { ...common, request_id: 'a'.repeat(32), flow_id: 'contact', flow_name: 'Contact', destination: 'earthora_contact', config_revision: 5,
      fields: { name: 'Synthetic', email: 'test@example.invalid', message: 'Question' }, field_labels: {} };
    vi.mocked(receiveStudioRequest).mockResolvedValue({ ok: true, data: { recorded: true } } as any);
    const response = await app.inject({ method: 'POST', url: '/platform/voice/internal/flow-request', headers, payload });
    expect(response.statusCode).toBe(200); expect(response.json().data.recorded).toBe(true);
    expect(receiveStudioRequest).toHaveBeenCalledWith(expect.objectContaining({ request_id: 'a'.repeat(32), validate_only: false }), { tenantId: 'tenant1', conversationId: 'conv1' });
    const calls = vi.mocked(receiveStudioRequest).mock.calls.length;
    expect((await app.inject({ method: 'POST', url: '/platform/voice/internal/flow-request', headers, payload: { ...payload, unrelated: 'x' } })).statusCode).toBe(400);
    vi.mocked(getChannelByKey).mockResolvedValue({ enabled: false, type: 'voice' } as any);
    expect((await app.inject({ method: 'POST', url: '/platform/voice/internal/flow-request', headers, payload })).statusCode).toBe(404);
    expect(receiveStudioRequest).toHaveBeenCalledTimes(calls);
  });
  it('provides live catalogue, published public knowledge and existing persona without an LLM call', async () => {
    const app = await server();
    const res = await app.inject({ method: 'POST', url: '/platform/voice/internal/context', headers, payload: common });
    expect(res.statusCode).toBe(200); expect(res.json()).toMatchObject({ persona: { name: 'Eva' }, catalog: [{ price: 10 }], knowledge: [{ title: 'Approved info' }] });
    const query = vi.mocked(sql).mock.calls.find(([strings]) => strings.join('').includes('FROM kb_chunks'))![0].join(' ');
    expect(query).toContain("c.visibility = 'public'"); expect(query).toContain("d.status = 'indexed'"); expect(query).toContain('effective_until'); expect(query).toContain('c.tenant_id');
    expect(res.body).not.toContain('test-key');
  });
  it('checks enabled channel and the configured phone channel', async () => {
    const app = await server();
    vi.mocked(getChannelByKey).mockResolvedValue({ enabled: false, type: 'voice' } as any);
    expect((await app.inject({ method: 'POST', url: '/platform/voice/internal/context', headers, payload: common })).statusCode).toBe(404);
    vi.mocked(getChannelByKey).mockResolvedValue({ enabled: true, type: 'voice', public_key: 'other' } as any);
    expect((await app.inject({ method: 'POST', url: '/platform/voice/internal/context', headers, payload: { ...common, channel: 'phone' } })).statusCode).toBe(404);
    expect(loadConversation).not.toHaveBeenCalled();
  });
  it('puts complete approved product records before copied documents and retains provenance', async () => {
    const canonical = { title: 'Product', text: 'Each tablet contains 500 mg of Moringa Leaf. ' + 'Approved detail. '.repeat(100), source: 'product_knowledge', source_id: 'fact1', product_id: 'product1', category: 'ingredients', question: null, locale: 'en-IN', version: 2, status: 'approved', approved_at: '2026-09-09T00:00:00Z', effective_from: '2026-09-09T00:00:00Z', effective_until: null };
    const indexed = { title: 'Website FAQ', text: 'Copied website wording.', source: 'kb_document', source_id: 'doc1', chunk_id: 'chunk1', product_ids: ['product1'], authority: 3, version: 1, status: 'indexed' };
    vi.mocked(sql).mockImplementation(((strings: TemplateStringsArray) => Promise.resolve(strings.join('').includes('FROM product_knowledge') ? [canonical] : [indexed])) as any);
    const app = await server();
    const res = await app.inject({ method: 'POST', url: '/platform/voice/internal/context', headers, payload: common });
    expect(res.statusCode).toBe(200); expect(res.json().knowledge).toEqual([canonical, indexed]);
    expect(res.json().knowledge[0].text.length).toBeGreaterThan(1400);
  });
  it('uses the same approved evidence for native search without executing the shared tool or saving state', async () => {
    const canonical = { title: 'Product', text: 'Each tablet contains 500 mg of Moringa Leaf.', source: 'product_knowledge', source_id: 'fact1', product_id: 'product1', category: 'ingredients', version: 1, status: 'approved' };
    vi.mocked(sql).mockResolvedValue([canonical] as any);
    vi.mocked(retrieve).mockImplementation(async () => { expect(inVoiceScope()).toBe(true); return []; });
    const app = await server();
    const request = { method: 'POST' as const, url: '/platform/voice/internal/tool', headers, payload: { ...common, call_id: 'search1', name: 'search_knowledge', arguments: { query: 'Product ingredients', productId: 'product1' } } };
    const res = await app.inject(request);
    expect(res.statusCode).toBe(200); expect(res.json()).toEqual({ ok: true, data: [canonical] });
    await app.inject(request);
    expect(retrieve).toHaveBeenCalledTimes(1); expect(run).not.toHaveBeenCalled(); expect(saveState).not.toHaveBeenCalled();
    const unknown = await app.inject({ ...request, payload: { ...request.payload, call_id: 'search2', arguments: { query: 'ingredients', productId: 'powder-not-in-current-catalog' } } });
    expect(unknown.json().ok).toBe(false); expect(retrieve).toHaveBeenCalledTimes(1);
  });
  it('executes tools in local-only voice scope and deduplicates cart mutation', async () => {
    const app = await server();
    const req = { method: 'POST' as const, url: '/platform/voice/internal/tool', headers, payload: { ...common, call_id: 'call1', name: 'add_to_cart', arguments: { productId: 'product1', quantity: 1 } } };
    const responses = await Promise.all([app.inject(req), app.inject(req)]);
    expect(responses.map(r => r.statusCode)).toEqual([200, 200]); expect(run).toHaveBeenCalledTimes(1); expect(saveState).toHaveBeenCalledTimes(1);
    expect((await app.inject({ ...req, payload: { ...req.payload, arguments: { productId: 'product1', quantity: 2 } } })).statusCode).toBe(409);
  });
  it('rejects unknown tools and oversized arguments', async () => {
    const app = await server();
    for (const values of [{ name: 'exec_shell', arguments: {} }, { name: 'capture_callback', arguments: { reason: 'x'.repeat(12001) } }]) {
      expect((await app.inject({ method: 'POST', url: '/platform/voice/internal/tool', headers, payload: { ...common, call_id: 'call1', ...values } })).statusCode).toBe(400);
    }
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects unexpected fields and non-string values before tool side effects', async () => {
    const app = await server();
    for (const [index, arguments_] of [{ secret_field: 'x' }, { reason: { text: 'x' } }].entries()) {
      expect((await app.inject({ method: 'POST', url: '/platform/voice/internal/tool', headers, payload: { ...common, call_id: `invalid${index}`, name: 'capture_callback', arguments: arguments_ } })).statusCode).toBe(400);
    }
    expect(run).not.toHaveBeenCalled();
  });
  it('persists a transcript once and does not retry a partially successful tool', async () => {
    const app = await server();
    const record = { method: 'POST' as const, url: '/platform/voice/internal/record', headers, payload: { ...common, message_id: 'msg1', role: 'user', text: 'Hello', language: 'en' } };
    expect((await app.inject(record)).statusCode).toBe(200); expect((await app.inject(record)).statusCode).toBe(200); expect(appendMessage).toHaveBeenCalledTimes(1);
    vi.mocked(saveState).mockRejectedValue(new Error('storage unavailable'));
    const tool = { method: 'POST' as const, url: '/platform/voice/internal/tool', headers, payload: { ...common, call_id: 'call2', name: 'add_to_cart', arguments: { productId: 'product1', quantity: 1 } } };
    expect((await app.inject(tool)).statusCode).toBe(500); expect((await app.inject(tool)).statusCode).toBe(500); expect(run).toHaveBeenCalledTimes(1);
  });
  it('isolates the same external session ID across two channels', async () => {
    const app = await server();
    vi.mocked(getChannelByKey).mockImplementation(async (key) => ({ id: key, tenant_id: 'tenant1', type: 'voice', enabled: true, public_key: key, published_config: {} }) as any);
    const request = (key: string) => app.inject({ method: 'POST', url: '/platform/voice/internal/record', headers, payload: { ...common, channel_key: key, message_id: 'same-message', role: 'user', text: 'Hello', language: 'en' } });
    const results = await Promise.all([request('channelA'), request('channelB')]);
    expect(results.map(r => r.statusCode)).toEqual([200, 200]);
    const identities = vi.mocked(loadConversation).mock.calls.map(([input]) => input.externalId);
    expect(new Set(identities).size).toBe(2);
    expect(identities.every(id => /^sunpath_[a-f0-9]{64}$/.test(id))).toBe(true);
    expect(appendMessage).toHaveBeenCalledTimes(2);
    await request('channelA');
    expect(appendMessage).toHaveBeenCalledTimes(2);
  });
  it('rejects blank, unknown and fuzzy product references before cart mutation', async () => {
    const app = await server();
    for (const name of ['add_to_cart', 'update_cart']) {
      for (const [index, productId] of ['', '   ', 'unknown', 'Product'].entries()) {
        const res = await app.inject({ method: 'POST', url: '/platform/voice/internal/tool', headers, payload: { ...common, call_id: `${name}${index}`, name, arguments: { productId, quantity: 1 } } });
        expect(res.statusCode).toBe(200); expect(res.json().ok).toBe(false);
      }
    }
    expect(run).not.toHaveBeenCalled(); expect(saveState).not.toHaveBeenCalled();
    const valid = await app.inject({ method: 'POST', url: '/platform/voice/internal/tool', headers, payload: { ...common, call_id: 'valid-product', name: 'add_to_cart', arguments: { productId: 'product1', quantity: 1 } } });
    expect(valid.statusCode).toBe(200); expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('SunPath native request, navigation and multilingual search boundary', () => {
  it('blocks stale callback clients from bypassing the durable review flow', async () => {
    const app = await server();
    const res = await app.inject({ method: 'POST', url: '/platform/voice/internal/tool', headers, payload: { ...common, call_id: 'legacy', name: 'capture_callback', arguments: { reason: 'callback', name: 'Synthetic', phone: '9876543210' } } });
    expect(res.statusCode).toBe(200); expect(res.json()).toMatchObject({ ok: false, message: expect.stringContaining('start_request') });
    expect(run).not.toHaveBeenCalled(); expect(saveState).not.toHaveBeenCalled();
  });
  it('exposes finite navigation only for browser contexts and denies phone navigation', async () => {
    const app = await server();
    const web = await app.inject({ method: 'POST', url: '/platform/voice/internal/context', headers, payload: common });
    expect(web.json().tools.some((t: any) => t.name === 'navigate_site')).toBe(true);
    expect(web.json().tools.some((t: any) => t.name === 'capture_callback')).toBe(false);
    expect(web.json().request_drafts).toEqual([]);
    const phone = await app.inject({ method: 'POST', url: '/platform/voice/internal/context', headers, payload: { ...common, channel: 'phone' } });
    expect(phone.json().tools.some((t: any) => t.name === 'navigate_site')).toBe(false);
    const denied = await app.inject({ method: 'POST', url: '/platform/voice/internal/tool', headers, payload: { ...common, channel: 'phone', call_id: 'phone-nav', name: 'navigate_site', arguments: { destination_id: 'contact' } } });
    expect(denied.json().ok).toBe(false);
    const guide = await app.inject({ method: 'GET', url: '/platform/voice/site-guide' });
    expect(guide.statusCode).toBe(200); expect(guide.json().destinations.some((d: any) => d.id === 'contact_form')).toBe(true);
  });
  it('gives the native LLM English semantic search guidance without changing the response language', async () => {
    const app = await server();
    const res = await app.inject({ method: 'POST', url: '/platform/voice/internal/context', headers, payload: common });
    expect(res.statusCode).toBe(200);
    const definitions = res.json().tools;
    const search = definitions.find((tool: { name: string }) => tool.name === 'search_knowledge');
    expect(search.description).toContain('English semantic keywords');
    expect(search.description).toContain('Hindi or Gujarati');
    expect(search.description).toContain('Answer the customer in their current language');
    expect(definitions.find((tool: { name: string }) => tool.name === 'get_cart')).toEqual({ name: 'get_cart' });
  });
});
