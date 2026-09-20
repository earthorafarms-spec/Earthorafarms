import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ chat: vi.fn(), retrieve: vi.fn(), catalogue: vi.fn(), route: vi.fn(), sql: Object.assign(vi.fn(), { json: (v: unknown) => v }) }));
vi.mock('../../db/client.js', () => ({ sql: mock.sql }));
vi.mock('../providers/index.js', () => ({ getLlm: () => ({ name: 'test-voice', chat: mock.chat }) }));
vi.mock('../kb/retrieve.js', () => ({ retrieve: mock.retrieve, evidenceBlock: () => ({ block: 'Approved product facts.', sources: [{ id: 'S1', title: 'Products' }] }) }));
vi.mock('./router.js', () => ({ routeTurn: mock.route }));
vi.mock('./functions.js', () => ({ BUILTIN_MAP: new Map([['list_products', { run: mock.catalogue }]]), toolDefsFor: () => [] }));
import { runTurn, type TurnInput } from './engine.js';
import { withVoiceScope } from '../providers/voiceScope.js';
import { voiceTurnLanguageRule } from './voicePolicy.js';

beforeEach(() => {
  vi.resetAllMocks();
  mock.sql.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('FROM workflows') ? [{ id: 'wf', slug: 'information', definition: { retrieval: { enabled: true } } }] : []);
  mock.route.mockResolvedValue({ workflowId: 'wf', slug: 'information', confidence: 1, language: 'hi', slots: {}, knowledgeQuery: 'moringa tablets price', reason: 'question', needsClarification: false });
  mock.retrieve.mockResolvedValue([]);
  mock.catalogue.mockResolvedValue({ ok: true, data: [{ name: 'Moringa Tablets', price: 499, mrp: 599, stock: 'in stock' }] });
});
function turn(overrides: Partial<TurnInput> = {}) {
  return withVoiceScope('tenant', () => runTurn({ tenantId: 'tenant', conversationId: 'conv', channelType: 'voice', message: 'Tablets ka price kya hai?', state: { slots: {}, cart: [], checkout: {}, language: 'hi', summary: '' }, contact: {}, history: [], persona: { maxWords: 40 }, ...overrides }));
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
  it('makes a switch back to English authoritative over Hindi/Gujarati history and repairs mismatched speech', async () => {
    mock.route.mockResolvedValue({ workflowId: 'wf', slug: 'information', confidence: 1, language: 'en', slots: {}, reason: 'English utterance', needsClarification: false });
    mock.chat.mockResolvedValueOnce({ text: 'नमस्ते! कृपया अपना ऑर्डर नंबर दें।', toolCalls: [] }).mockResolvedValueOnce({ text: 'Could you share your order number so I can check its status?', toolCalls: [] });
    const result = await turn({ message: 'Hello, can you help me check my order status?', history: [{ role: 'user', content: 'મારા order ની માહિતી આપો.' }, { role: 'assistant', content: 'कृपया अपना order number बताएं।' }] });
    expect(result.state.language).toBe('en');
    expect(result.reply).toBe('Could you share your order number so I can check its status?');
    const messages = mock.chat.mock.calls[0][0];
    const guard = messages.findIndex((message: any) => message.role === 'system' && message.content === voiceTurnLanguageRule('en'));
    expect(guard).toBeGreaterThan(messages.findLastIndex((message: any) => message.role === 'assistant'));
    expect(guard).toBeLessThan(messages.length - 1);
    expect(messages[0].content).not.toContain('कर सकती हूँ');
    expect(mock.chat.mock.calls[1][0].some((message: any) => message.content.includes('language-mismatch'))).toBe(true);
  });
  it('never speaks the previous language when a language repair is ignored', async () => {
    mock.route.mockResolvedValue({ workflowId: 'wf', slug: 'information', confidence: 1, language: 'en', slots: {}, reason: 'English utterance', needsClarification: false });
    mock.chat.mockResolvedValue({ text: 'હું તમારા ઓર્ડરની માહિતી આપી શકું છું.', toolCalls: [] });
    const result = await turn({ message: 'Please help me in English.' });
    expect(result.state.language).toBe('en');
    expect(result.reply).toBe('How can I help you with your Earthora products or order?');
    expect(mock.chat).toHaveBeenCalledTimes(2);
  });
  it('retains natural mixed Hindi-English speech when the current customer uses Hinglish', async () => {
    const hinglish = 'हाँ, मैं आपका order status check कर सकती हूँ। आपका order number क्या है?';
    mock.chat.mockResolvedValue({ text: hinglish, toolCalls: [] });
    const result = await turn({ message: 'Mujhe order status check karna hai, can you help?', history: [{ role: 'assistant', content: 'How can I help you?' }] });
    expect(result.reply).toBe(hinglish); expect(result.state.language).toBe('hi');
    expect(mock.chat.mock.calls[0][0][0].content).toContain('conversational Hindi with familiar English words');
    expect(mock.chat.mock.calls[0][0].some((message: any) => message.content === voiceTurnLanguageRule('hi'))).toBe(true);
    expect(mock.chat).toHaveBeenCalledTimes(1);
  });
});
