import { beforeEach, describe, expect, it, vi } from 'vitest';
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('openai', () => ({
  default: class { audio = { transcriptions: { create } }; },
  toFile: vi.fn(async () => 'audio-file'),
}));
import { OpenAiSttAdapter } from '../../src/adapters/openai-stt.js';
import { normalizeVoiceTranscript } from '../../src/conversation/transcript.js';

describe('OpenAI phone transcription', () => {
  beforeEach(() => create.mockReset());
  it.each(['yes', '2', 'Ahmedabad, Gujarat', 'हाँ', 'दो'])('preserves the short answer %s', async (text) => {
    create.mockResolvedValueOnce({ text });
    const result = await new OpenAiSttAdapter().transcribe(Buffer.alloc(100), { format: 'wav', languageHint: 'hi' });
    expect(result.text).toBe(text);
    expect(normalizeVoiceTranscript(result).accepted).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].prompt).toContain('Earthora');
    expect(create.mock.calls[0][0].language).toBeUndefined();
  });
  it('retries an unrelated script using the active language, once only', async () => {
    create.mockResolvedValueOnce({ text: 'مرحبا' }).mockResolvedValueOnce({ text: 'दो' });
    const result = await new OpenAiSttAdapter().transcribe(Buffer.alloc(100), { languageHint: 'hi' });
    expect(result).toMatchObject({ text: 'दो', wasRetried: true });
    expect(create.mock.calls[1][0].language).toBe('hi');
    expect(create.mock.calls[1][1].timeout).toBeLessThanOrEqual(create.mock.calls[0][1].timeout);
  });
  it('never passes a still-unsupported retry into the conversation', async () => {
    create.mockResolvedValue({ text: 'مرحبا' });
    const result = await new OpenAiSttAdapter().transcribe(Buffer.alloc(100), { languageHint: 'en' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(normalizeVoiceTranscript(result)).toMatchObject({ accepted: false, reason: 'unsupported_script' });
  });
  it('does not retry empty audio into an invented answer', async () => {
    create.mockResolvedValue({ text: '' });
    await new OpenAiSttAdapter().transcribe(Buffer.alloc(100), { languageHint: 'en' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
