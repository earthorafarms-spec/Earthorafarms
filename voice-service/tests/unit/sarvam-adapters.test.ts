import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transcribe: vi.fn(), convert: vi.fn(), chat: vi.fn() }));

function silentPcm16Wav(): Buffer {
  const wav = Buffer.alloc(46);
  wav.write('RIFF', 0); wav.writeUInt32LE(38, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(2, 40); wav.writeInt16LE(0, 44);
  return wav;
}
vi.mock('sarvamai', () => ({
  SarvamAIClient: class {
    constructor(private options: { apiSubscriptionKey: string }) {}
    speechToText = { transcribe: (r: unknown, o: unknown) => mocks.transcribe(this.options.apiSubscriptionKey, r, o) };
    textToSpeech = { convert: (r: unknown, o: unknown) => mocks.convert(this.options.apiSubscriptionKey, r, o) };
    chat = { completions: (r: unknown, o: unknown) => mocks.chat(this.options.apiSubscriptionKey, r, o) };
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv('SARVAM_API_KEYS', 'fake-one,fake-two,fake-three');
  vi.stubEnv('SARVAM_API_KEY', 'fake-legacy');
});
afterEach(() => vi.unstubAllEnvs());
const quota = { statusCode: 402, body: { error: { code: 'insufficient_quota_error' } } };

describe('Sarvam adapter failover', () => {
  it('retries the same audio and shares the exhausted key state with TTS and chat', async () => {
    mocks.transcribe.mockRejectedValueOnce(quota).mockResolvedValue({ transcript: 'hello', language_code: 'en-IN', language_probability: 0.99 });
    mocks.convert.mockResolvedValue({ audios: [silentPcm16Wav().toString('base64')] });
    mocks.chat.mockResolvedValue({ choices: [{ message: { content: 'reply' } }] });
    const { SarvamSttAdapter } = await import('../../src/adapters/sarvam-stt.js');
    const { SarvamTtsAdapter } = await import('../../src/adapters/sarvam-tts.js');
    const { SarvamLLMAdapter } = await import('../../src/adapters/sarvam.js');
    const audio = Buffer.from('test audio');
    expect(await new SarvamSttAdapter().transcribe(audio, { format: 'wav' })).toMatchObject({ text: 'hello', detectedLanguage: 'en' });
    expect(mocks.transcribe.mock.calls.map(([key]) => key)).toEqual(['fake-one', 'fake-two']);
    for (const [, request, options] of mocks.transcribe.mock.calls) {
      expect(request.file.data).toBe(audio);
      expect(request.file.filename).toBe('utterance.wav');
      expect(options.maxRetries).toBe(0);
      expect(options.timeoutInSeconds).toBeGreaterThan(0);
      expect(options.timeoutInSeconds).toBeLessThanOrEqual(15);
    }
    await new SarvamTtsAdapter().synthesize('Hello.', 'en');
    await new SarvamTtsAdapter().synthesizeMulaw8k('Hello.', 'hi');
    expect(mocks.convert.mock.calls.map(([key]) => key)).toEqual(['fake-two', 'fake-two']);
    expect(await new SarvamLLMAdapter().chatWithTools([], [])).toEqual({ kind: 'message', content: 'reply' });
    expect(mocks.chat.mock.calls[0][0]).toBe('fake-two');
  });

  it('also rotates if the language-confidence retry runs out of credits', async () => {
    mocks.transcribe.mockResolvedValueOnce({ transcript: 'uncertain', language_code: 'hi-IN', language_probability: 0.2 })
      .mockRejectedValueOnce(quota).mockResolvedValue({ transcript: 'corrected', language_code: 'hi-IN' });
    const { SarvamSttAdapter } = await import('../../src/adapters/sarvam-stt.js');
    expect(await new SarvamSttAdapter().transcribe(Buffer.from('audio'), { languageHint: 'hi' })).toMatchObject({ text: 'corrected', detectedLanguage: 'hi', wasRetried: true });
    expect(mocks.transcribe.mock.calls.map(([key, request]) => [key, request.language_code])).toEqual([
      ['fake-one', 'unknown'], ['fake-one', 'hi-IN'], ['fake-two', 'hi-IN'],
    ]);
  });

  it.each(['synthesize', 'synthesizeMulaw8k'] as const)('rotates credits failures during %s', async (method) => {
    const wav = silentPcm16Wav();
    mocks.convert.mockRejectedValueOnce(quota).mockResolvedValue({ audios: [wav.toString('base64')] });
    const { SarvamTtsAdapter } = await import('../../src/adapters/sarvam-tts.js');
    const audio = await new SarvamTtsAdapter()[method]('Hello.', 'gu');
    if (method === 'synthesize') expect(audio).toEqual(wav);
    else expect(audio.length).toBeGreaterThan(0);
    expect(mocks.convert.mock.calls.map(([key]) => key)).toEqual(['fake-one', 'fake-two']);
    expect(mocks.convert.mock.calls[1][1]).toEqual(mocks.convert.mock.calls[0][1]);
  });

  it('uses clear native-speed Indic settings and converts native WAV for telephony', async () => {
    const wav = silentPcm16Wav();
    mocks.convert.mockResolvedValue({ audios: [wav.toString('base64')] });

    const { SarvamTtsAdapter } = await import('../../src/adapters/sarvam-tts.js');
    await new SarvamTtsAdapter().synthesize('यह एक साफ़ जवाब है।', 'hi');
    await new SarvamTtsAdapter().synthesizeMulaw8k('આ એક સ્પષ્ટ જવાબ છે.', 'gu');

    expect(mocks.convert.mock.calls[0][1]).toMatchObject({
      language_code: 'hi-IN', speaker: 'priya', pace: 1,
      speech_sample_rate: 24000, output_audio_codec: 'wav',
    });
    expect(mocks.convert.mock.calls[1][1]).toMatchObject({
      language_code: 'gu-IN', speaker: 'priya', pace: 1,
      speech_sample_rate: 24000, output_audio_codec: 'wav',
    });
  });

  it('preserves chat tool calls after failover', async () => {
    mocks.chat.mockRejectedValueOnce(quota).mockResolvedValue({ choices: [{ message: { tool_calls: [{ id: 'call1', function: { name: 'get_cart', arguments: '{}' } }] } }] });
    const { SarvamLLMAdapter } = await import('../../src/adapters/sarvam.js');
    expect(await new SarvamLLMAdapter().chatWithTools([], [])).toEqual({ kind: 'tool_calls', calls: [{ id: 'call1', name: 'get_cart', argumentsJson: '{}' }] });
    expect(mocks.chat.mock.calls.map(([key]) => key)).toEqual(['fake-one', 'fake-two']);
    expect(mocks.chat.mock.calls[1][1]).toEqual(mocks.chat.mock.calls[0][1]);
  });

  it('keeps the legacy single-key configuration working', async () => {
    vi.stubEnv('SARVAM_API_KEYS', '');
    mocks.transcribe.mockResolvedValue({ transcript: 'hello', language_code: 'en-IN' });
    const { SarvamSttAdapter } = await import('../../src/adapters/sarvam-stt.js');
    await new SarvamSttAdapter().transcribe(Buffer.from('audio'));
    expect(mocks.transcribe.mock.calls[0][0]).toBe('fake-legacy');
  });
});
