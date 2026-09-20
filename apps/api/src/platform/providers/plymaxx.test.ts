import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../config.js', () => ({ config: { AI_BASE_URL: 'https://ai.example.test/v1', AI_API_KEY: 'voice-test-key', AI_LLM_MODEL: 'qwen3.5:9b' } }));
import { fitVoiceContext, plymaxxVoiceLlm } from './plymaxx.js';
import { getLlm } from './index.js';
import { inVoiceScope, withVoiceScope } from './voiceScope.js';
import type { ChatMessage } from './types.js';

afterEach(() => vi.unstubAllGlobals());
const tool = { name: 'add_to_cart', description: 'Add a selected item', parameters: { type: 'object', properties: { productId: { type: 'string' }, quantity: { type: 'integer' } }, required: ['productId', 'quantity'] } };

describe('voice-scoped Qwen', () => {
  it('keeps parallel web chat on its configured provider', async () => {
    const defaultProvider = getLlm();
    await withVoiceScope('tenant', async () => { expect(getLlm()).toBe(plymaxxVoiceLlm); await Promise.resolve(); expect(inVoiceScope()).toBe(true); });
    expect(inVoiceScope()).toBe(false); expect(getLlm()).toBe(defaultProvider);
    expect(defaultProvider.name).toBe('openai');
  });
  it('disables thinking, caps output, and never calls another provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Hello.' } }] }))));
    expect((await plymaxxVoiceLlm.chat([{ role: 'user', content: 'hello' }], { maxTokens: 900 })).text).toBe('Hello.');
    const [url, options] = vi.mocked(fetch).mock.calls[0]; const request = JSON.parse(options!.body as string);
    expect(url).toBe('https://ai.example.test/v1/chat/completions');
    expect(request).toMatchObject({ max_tokens: 256, think: false, thinking: false, chat_template_kwargs: { enable_thinking: false } });
  });
  it.each([
    ['length', '{"productId":"tablets","quantity":2}'],
    ['tool_calls', '{"productId":'],
    ['tool_calls', '{}'],
    ['tool_calls', '{"productId":"tablets","quantity":"two"}'],
  ])('rejects incomplete or malformed tool arguments (%s)', async (reason, args) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: reason, message: { tool_calls: [{ id: 'call_1', function: { name: 'add_to_cart', arguments: args } }] } }] }))));
    await expect(plymaxxVoiceLlm.chat([{ role: 'user', content: 'add two tablets' }], { tools: [tool] })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('trims old history while preserving grounding and this turn’s tool exchange', () => {
    const messages: ChatMessage[] = [{ role: 'system', content: 'Approved facts only.' }, { role: 'user', content: 'old '.repeat(9000) }, { role: 'assistant', content: 'old answer' }, { role: 'user', content: 'What is the price?' }, { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'get_cart', arguments: {} }] }, { role: 'tool', tool_call_id: 'c1', content: '{"total":499}' }];
    const fitted = fitVoiceContext(messages, [], 256);
    expect(fitted).toContain(messages[0]); expect(fitted).not.toContain(messages[1]);
    expect(fitted.slice(-3)).toEqual(messages.slice(-3));
    expect(() => fitVoiceContext([{ role: 'system', content: 'अ'.repeat(9000) }, { role: 'user', content: 'hello' }], [], 256)).toThrow('context budget');
  });
  it('preserves the language override after multilingual history when fitting context', () => {
    const messages: ChatMessage[] = [{ role: 'system', content: 'Approved facts only.' }, { role: 'user', content: 'મારા order ની માહિતી આપો.' }, { role: 'assistant', content: 'कृपया अपना order number बताएं।' }, { role: 'system', content: 'CURRENT TURN LANGUAGE: English. Previous conversation language must not override it.' }, { role: 'user', content: 'Hello, help me check my order status.' }];
    expect(fitVoiceContext(messages, [], 256)).toEqual(messages);
  });
});
