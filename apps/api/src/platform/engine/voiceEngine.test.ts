import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ chat: vi.fn(), retrieve: vi.fn(), catalogue: vi.fn(), route: vi.fn(), sql: Object.assign(vi.fn(), { json: (v: unknown) => v }) }));
vi.mock('../../db/client.js', () => ({ sql: mock.sql }));
vi.mock('../providers/index.js', () => ({ getLlm: () => ({ name: 'test-voice', chat: mock.chat }) }));
vi.mock('../kb/retrieve.js', () => ({ retrieve: mock.retrieve, evidenceBlock: () => ({ block: 'Approved product facts.', sources: [{ id: 'S1', title: 'Products' }] }) }));
vi.mock('./router.js', () => ({ routeTurn: mock.route }));
vi.mock('./functions.js', () => ({ BUILTIN_MAP: new Map([['list_products', { run: mock.catalogue }]]), toolDefsFor: () => [] }));
import { runTurn } from './engine.js';
import { withVoiceScope } from '../providers/voiceScope.js';

beforeEach(() => {
  vi.resetAllMocks();
  mock.sql.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('FROM workflows') ? [{ id: 'wf', slug: 'information', definition: { retrieval: { enabled: true } } }] : []);
  mock.route.mockResolvedValue({ workflowId: 'wf', slug: 'information', confidence: 1, language: 'hi', slots: {}, knowledgeQuery: 'moringa tablets price', reason: 'question', needsClarification: false });
  mock.retrieve.mockResolvedValue([]);
  mock.catalogue.mockResolvedValue({ ok: true, data: [{ name: 'Moringa Tablets', price: 499, mrp: 599, stock: 'in stock' }] });
});
function turn() {
  return withVoiceScope('tenant', () => runTurn({ tenantId: 'tenant', conversationId: 'conv', channelType: 'voice', message: 'Tablets ka price kya hai?', state: { slots: {}, cart: [], checkout: {}, language: 'hi', summary: '' }, contact: {}, history: [], persona: { maxWords: 40 } }));
}

describe('full voice engine output boundary', () => {
  it('retrieves approved evidence and current prices before generation and repairs invented prices', async () => {
    mock.chat.mockResolvedValueOnce({ text: 'Tablets ₹999 के हैं।', toolCalls: [] }).mockResolvedValueOnce({ text: 'Tablets ₹499 के हैं।', toolCalls: [] });
    const result = await turn();
    expect(result.reply).toBe('Tablets ₹499 के हैं।');
    expect(mock.retrieve).toHaveBeenCalledWith('moringa tablets price', expect.any(Object));
    const system = mock.chat.mock.calls[0][0][0].content;
    expect(system).toContain('Approved product facts.'); expect(system).toContain('LIVE CATALOGUE'); expect(system).toContain('Hinglish');
    expect(mock.chat.mock.calls[1][0].some((message: any) => message.content.includes('ungrounded-price'))).toBe(true);
  });
  it('returns a neutral safe sentence when repair still claims payment completed', async () => {
    mock.chat.mockResolvedValue({ text: 'Payment received. Your order is placed.', toolCalls: [] });
    const result = await turn();
    expect(result.reply).not.toContain('Payment received'); expect(result.reply).toContain('चेक कर लेती हूँ');
    expect(mock.chat).toHaveBeenCalledTimes(2);
  });
});
