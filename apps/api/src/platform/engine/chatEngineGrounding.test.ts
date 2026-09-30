import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ chat: vi.fn(), retrieve: vi.fn(), catalogue: vi.fn(), route: vi.fn(), sql: Object.assign(vi.fn(), { json: (v: unknown) => v }) }));
vi.mock('../../db/client.js', () => ({ sql: mock.sql }));
vi.mock('../providers/index.js', () => ({ getLlm: () => ({ name: 'test-chat', chat: mock.chat }) }));
vi.mock('../kb/retrieve.js', () => ({ retrieve: mock.retrieve, evidenceBlock: () => ({ block: 'Old website: tablets and powder; Farm Location: Warehouse No. E-34, Gujarat.', sources: [] }) }));
vi.mock('./router.js', () => ({ routeTurn: mock.route }));
vi.mock('./functions.js', () => ({ BUILTIN_MAP: new Map([['list_products', { run: mock.catalogue }]]), toolDefsFor: () => [] }));
import { runTurn, type TurnInput } from './engine.js';

beforeEach(() => {
  vi.resetAllMocks();
  mock.sql.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('FROM workflows') ? [{ id: 'wf', slug: 'information', definition: { retrieval: { enabled: true } } }] : []);
  mock.route.mockResolvedValue({ workflowId: 'wf', slug: 'information', confidence: 1, language: 'en', slots: {}, reason: 'question', needsClarification: false });
  mock.retrieve.mockResolvedValue([]);
  mock.catalogue.mockResolvedValue({ ok: true, data: [{ id: 'p1', name: 'Current Tablet', price: 999, stock: 'in stock' }] });
  mock.chat.mockResolvedValue({ text: 'Here is the current product.', toolCalls: [] });
});

function turn(message: string, overrides: Partial<TurnInput> = {}) {
  return runTurn({ tenantId: 'tenant', conversationId: 'conv', channelType: 'chat', message, state: { slots: {}, cart: [], checkout: {}, language: 'en', summary: '' }, contact: {}, history: [], ...overrides });
}

describe('typed chat live grounding before generation', () => {
  it('does not let a model or stale source substitute warehouse and powder for current truth', async () => {
    mock.chat.mockResolvedValue({ text: 'We sell tablets and powder and the farm is at the Gujarat warehouse.', toolCalls: [] });
    const result = await turn('What is Earthora Farms, and where is the farm located?');
    expect(result.reply).toContain('Current Tablet');
    expect(result.reply).toContain('cannot confirm the exact farm location');
    expect(result.reply).not.toMatch(/powder|Gujarat/i);
    expect(mock.chat).not.toHaveBeenCalled();
    expect(mock.retrieve).not.toHaveBeenCalled();
    expect(result.toolCalls).toEqual([{ name: 'list_products', ok: true }]);
  });

  it('answers a company detour rather than asking a missing checkout field', async () => {
    mock.sql.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('FROM workflows') ? [{ id: 'wf', slug: 'checkout', definition: { slots: [{ key: 'phone', required: true, question: { en: 'Phone number?' } }] } }] : []);
    const result = await turn('What is Earthora Farms?');
    expect(result.reply).toContain('Current Tablet');
    expect(result.reply).not.toContain('Phone number');
  });

  it('keeps normal chat generation and supplies live source priority, without fixed product formats', async () => {
    await turn('What products do you currently offer?', { persona: { custom: 'Old marketing says powder.' } });
    const system = mock.chat.mock.calls[0][0][0].content;
    expect(system).toContain('LIVE CATALOGUE');
    expect(system).toContain('Current Tablet');
    expect(system).toContain('An ingredient such as leaf powder is not a separately sold powder product.');
    expect(system).not.toContain('brand (tablets and powder)');
    expect(system.indexOf('Current factual boundaries')).toBeGreaterThan(system.indexOf('Old marketing says powder.'));
    expect(mock.retrieve).toHaveBeenCalledOnce();
  });

  it('never reports catalogue absence after lookup failure', async () => {
    mock.catalogue.mockRejectedValue(new Error('Database unavailable'));
    const result = await turn('What is Earthora Farms?');
    expect(result.reply).toContain('cannot verify the current product catalogue');
    expect(result.reply).not.toContain('No active products');
    expect(result.toolCalls).toEqual([{ name: 'list_products', ok: false }]);
  });
});
