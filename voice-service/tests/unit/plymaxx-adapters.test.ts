import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Every test stubs global fetch — nothing here touches the GPU server.
const BASE = 'https://gpu.test/v1';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv('AI_BASE_URL', BASE);
  vi.stubEnv('AI_API_KEY', 'test-gpu-key');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function pcmResponse(samples: number, sampleRate = 22_050): Response {
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(8_000 * Math.sin(i / 8)), i * 2);
  return new Response(new Uint8Array(pcm), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Audio-Sample-Rate': String(sampleRate),
      'X-Audio-Channels': '1',
      'X-Audio-Format': 'pcm_s16le',
    },
  });
}

/** The JSON body of the most recent request. */
function lastRequestBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]!;
  return JSON.parse((call[1] as { body: string }).body) as Record<string, unknown>;
}

/** The multipart fields of the most recent request. */
function lastFormFields(): Record<string, string> {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]!;
  const form = (call[1] as { body: FormData }).body;
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') out[k] = v;
  return out;
}

describe('PlymaxxSttAdapter model selection', () => {
  it('sends English to Whisper on the GPU — no paid fallback anywhere', async () => {
    const { PlymaxxSttAdapter } = await import('../../src/adapters/plymaxx-stt.js');
    fetchMock.mockResolvedValueOnce(jsonResponse({ text: 'Hello, I would like two packs.', language: 'en' }));

    const result = await new PlymaxxSttAdapter().transcribe(Buffer.from('audio'), { languageHint: 'en', format: 'wav' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE}/audio/transcriptions`);
    expect(lastFormFields()).toMatchObject({ model: 'whisper-large-v3-turbo', language: 'en' });
    expect(result.text).toBe('Hello, I would like two packs.');
    expect(result.detectedLanguage).toBe('en');
  });

  it('routes Gujarati to the Indic conformer and Hindi to Whisper', async () => {
    const { PlymaxxSttAdapter } = await import('../../src/adapters/plymaxx-stt.js');
    const adapter = new PlymaxxSttAdapter();

    fetchMock.mockResolvedValueOnce(jsonResponse({ text: 'नमस्ते', language: 'hi' }));
    await adapter.transcribe(Buffer.from('a'), { languageHint: 'hi', format: 'wav' });
    expect(lastFormFields()).toMatchObject({ model: 'whisper-large-v3-turbo', language: 'hi' });

    fetchMock.mockResolvedValueOnce(jsonResponse({ text: 'નમસ્તે કેમ છો' }));
    const gu = await adapter.transcribe(Buffer.from('a'), { languageHint: 'gu', format: 'wav' });
    expect(lastFormFields()).toMatchObject({ model: 'indic-conformer-600m-multilingual', language: 'gu' });
    // The Indic route reports no language, so script detection fills it in.
    expect(gu.detectedLanguage).toBe('gu');
  });

  it('asks Whisper to auto-detect when the language is not yet known', async () => {
    const { PlymaxxSttAdapter } = await import('../../src/adapters/plymaxx-stt.js');
    fetchMock.mockResolvedValueOnce(jsonResponse({ text: 'Hello there', language: 'en' }));

    const result = await new PlymaxxSttAdapter().transcribe(Buffer.from('a'), { format: 'wav' });
    // Whisper's own default language is Hindi, so 'auto' must be explicit or
    // an English first utterance would be transcribed as Hindi.
    expect(lastFormFields()).toMatchObject({ language: 'auto', response_format: 'verbose_json' });
    expect(result.detectedLanguage).toBe('en');
  });

  it('keeps a spoken phone number that repeats a digit', async () => {
    const { PlymaxxSttAdapter, looksLikeTranscriptionLoop } = await import('../../src/adapters/plymaxx-stt.js');
    // Six zeros in a ten-digit number is 60% one word. A frequency-based guard
    // discarded this and silently blocked phone/PIN capture.
    const phone = 'शून्य शून्य शून्य शून्य शून्य शून्य नौ आठ सात छह';
    expect(looksLikeTranscriptionLoop(phone)).toBe(false);

    fetchMock.mockResolvedValueOnce(jsonResponse({ text: phone, language: 'hi' }));
    const result = await new PlymaxxSttAdapter().transcribe(Buffer.from('a'), {
      languageHint: 'hi',
      format: 'wav',
      expectedInput: 'phone',
    });
    expect(result.text).toBe(phone);
  });

  it('discards a Whisper repetition loop instead of speaking it back', async () => {
    const { PlymaxxSttAdapter, looksLikeTranscriptionLoop } = await import('../../src/adapters/plymaxx-stt.js');
    const loop = `हलो, एप ${'लोग '.repeat(40)}`.trim();
    expect(looksLikeTranscriptionLoop(loop)).toBe(true);
    expect(looksLikeTranscriptionLoop('नमस्ते, मोरिंगा पाउडर की कीमत क्या है')).toBe(false);

    fetchMock.mockResolvedValueOnce(jsonResponse({ text: loop, language: 'hi' }));
    const result = await new PlymaxxSttAdapter().transcribe(Buffer.from('a'), { languageHint: 'hi', format: 'wav' });
    expect(result.text).toBe('');
  });
});

describe('PlymaxxLLMAdapter', () => {
  const tools = [
    {
      name: 'set_checkout_field',
      description: 'Set one checkout field',
      parameters: { type: 'object' as const, properties: { field: { type: 'string' } }, required: ['field'], additionalProperties: false as const },
    },
  ];

  it('maps tool calls onto the adapter contract', async () => {
    const { PlymaxxLLMAdapter } = await import('../../src/adapters/plymaxx-llm.js');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { tool_calls: [{ id: 'call_a', function: { name: 'set_checkout_field', arguments: '{"field":"city"}' } }] }, finish_reason: 'tool_calls' }],
      }),
    );

    const result = await new PlymaxxLLMAdapter().chatWithTools([{ role: 'user', content: 'Ahmedabad' }], tools);
    expect(result).toEqual({
      kind: 'tool_calls',
      calls: [{ id: 'call_a', name: 'set_checkout_field', argumentsJson: '{"field":"city"}' }],
    });
  });

  it('refuses a tool call whose arguments were truncated, instead of running it with {}', async () => {
    const { PlymaxxLLMAdapter } = await import('../../src/adapters/plymaxx-llm.js');
    // The controller parses argumentsJson with a catch that falls back to {},
    // so passing this through would silently mutate the order.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        choices: [
          {
            message: { tool_calls: [{ id: 'call_a', function: { name: 'set_checkout_field', arguments: '{"field":"Ahmeda' } }] },
            finish_reason: 'length',
          },
        ],
      }),
    );

    await expect(new PlymaxxLLMAdapter().chatWithTools([{ role: 'user', content: 'hi' }], tools)).rejects.toThrow(
      /cut off by the 256-token generation cap/,
    );
  });

  it('refuses a truncated tool call even when its arguments happen to parse', async () => {
    const { PlymaxxLLMAdapter } = await import('../../src/adapters/plymaxx-llm.js');
    // The cut can land on the function NAME, leaving valid-looking arguments
    // attached to a tool that does not exist.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        choices: [
          { message: { tool_calls: [{ id: 'c', function: { name: 'set_checkout_fi', arguments: '{}' } }] }, finish_reason: 'length' },
        ],
      }),
    );
    await expect(new PlymaxxLLMAdapter().chatWithTools([{ role: 'user', content: 'hi' }], tools)).rejects.toThrow(/cut off/);
  });

  it('accepts a no-argument tool call serialized as an empty string', async () => {
    const { PlymaxxLLMAdapter, isUsableToolArguments } = await import('../../src/adapters/plymaxx-llm.js');
    // Tools like get_cart declare `properties: {}` and are legitimately called
    // with nothing; some servers send "" rather than "{}".
    expect(isUsableToolArguments('')).toBe(true);
    expect(isUsableToolArguments('{}')).toBe(true);
    expect(isUsableToolArguments('{"a":1')).toBe(false);
    expect(isUsableToolArguments('[1,2]')).toBe(false);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 'get_cart', arguments: '' } }] }, finish_reason: 'tool_calls' }] }),
    );
    const result = await new PlymaxxLLMAdapter().chatWithTools([{ role: 'user', content: 'cart?' }], tools);
    expect(result.kind).toBe('tool_calls');
  });

  it('fails loudly when the model returns neither text nor a tool call', async () => {
    const { PlymaxxLLMAdapter } = await import('../../src/adapters/plymaxx-llm.js');
    // An empty string here would be silence on a live call.
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '   ' }, finish_reason: 'stop' }] }));
    await expect(new PlymaxxLLMAdapter().chatWithTools([{ role: 'user', content: 'hi' }], [])).rejects.toThrow(
      /no text and no tool call/,
    );
  });

  it('asks for no more than the server-enforced generation cap', async () => {
    const { PlymaxxLLMAdapter } = await import('../../src/adapters/plymaxx-llm.js');
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
    await new PlymaxxLLMAdapter().chatWithTools([{ role: 'user', content: 'hi' }], []);

    const body = lastRequestBody();
    expect(body.max_tokens).toBe(256);
    expect(body.stream).toBe(false);
    expect(body.model).toBe('qwen3.5:9b');
  });

  it('returns assistant text when no tool was called', async () => {
    const { PlymaxxLLMAdapter } = await import('../../src/adapters/plymaxx-llm.js');
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'केवल भारत में' }, finish_reason: 'stop' }] }));
    const result = await new PlymaxxLLMAdapter().chatWithTools([{ role: 'user', content: 'ship?' }], []);
    expect(result).toEqual({ kind: 'message', content: 'केवल भारत में' });
  });
});

describe('fitToContext', () => {
  it('keeps real conversation history under the REAL system prompt and tool set', async () => {
    // Regression test for a bug that discarded every prior turn on every turn.
    // A uniform chars/2 estimate made the 11k-character English system prompt
    // look like ~5.5k tokens, which alone exceeded the budget left after the
    // tool schemas — so trimming kept only the newest message and the bot
    // forgot what it had just asked, mid-checkout. Uses the production prompt
    // and tools on purpose: a synthetic prompt would not have caught it.
    const { fitToContext, estimateTextTokens } = await import('../../src/adapters/plymaxx-llm.js');
    const { SYSTEM_PROMPT } = await import('../../src/conversation/prompt.js');
    const { allTools } = await import('../../src/tools/index.js');

    const toolsOverhead = allTools.reduce(
      (sum, t) => sum + estimateTextTokens(t.definition.name + t.definition.description + JSON.stringify(t.definition.parameters)),
      0,
    );

    const conversation = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'system' as const, content: 'DURABLE ORDER STATE: cart=[], checkoutFields={}' },
      { role: 'user' as const, content: 'मोरिंगा पाउडर की कीमत क्या है?' },
      { role: 'assistant' as const, content: 'दो सौ निन्यानवे रुपये।' },
      { role: 'user' as const, content: 'ठीक है, दो पैकेट भेज दीजिए।' },
      { role: 'assistant' as const, content: 'आपका पिन कोड क्या है?' },
      { role: 'user' as const, content: 'तीन आठ शून्य शून्य पाँच शून्य' },
    ];

    const { messages: fitted, droppedCount } = fitToContext(conversation, 256, toolsOverhead);
    expect(droppedCount).toBe(0);
    expect(fitted).toHaveLength(conversation.length);
    // The question the assistant asked must survive, or it repeats itself.
    expect(fitted.some((m) => m.content === 'आपका पिन कोड क्या है?')).toBe(true);
  });

  it('estimates Latin and Indic text at different densities', async () => {
    const { estimateTextTokens } = await import('../../src/adapters/plymaxx-llm.js');
    const english = 'a'.repeat(400);
    const hindi = 'क'.repeat(400);
    expect(estimateTextTokens(english)).toBe(100);
    expect(estimateTextTokens(hindi)).toBe(400);
    // A single ratio for both is what caused the history-loss regression.
    expect(estimateTextTokens(hindi)).toBeGreaterThan(estimateTextTokens(english) * 3);
  });

  it('keeps every system message and drops the oldest turns first', async () => {
    const { fitToContext } = await import('../../src/adapters/plymaxx-llm.js');
    const long = 'क'.repeat(4_000);
    const messages = [
      { role: 'system' as const, content: 'persona' },
      { role: 'system' as const, content: 'grounding facts' },
      ...Array.from({ length: 8 }, (_, i) => ({ role: 'user' as const, content: `${long}#${i}` })),
    ];

    const { messages: fitted, droppedCount } = fitToContext(messages, 256, 0);
    expect(droppedCount).toBeGreaterThan(0);
    expect(fitted.filter((m) => m.role === 'system')).toHaveLength(2);
    expect(fitted[fitted.length - 1]!.content.endsWith('#7')).toBe(true);
  });

  it('never orphans a tool result from the assistant message that requested it', async () => {
    const { fitToContext } = await import('../../src/adapters/plymaxx-llm.js');
    const filler = 'ક'.repeat(3_000);
    const messages = [
      { role: 'system' as const, content: 'persona' },
      ...Array.from({ length: 6 }, (_, i) => ({ role: 'user' as const, content: `${filler}#${i}` })),
      { role: 'assistant' as const, content: '', toolCalls: [{ id: 'c1', name: 'get_price', argumentsJson: '{}' }] },
      { role: 'tool' as const, content: '299', toolCallId: 'c1', toolName: 'get_price' },
    ];

    const { messages: fitted } = fitToContext(messages, 256, 0);
    for (const result of fitted.filter((m) => m.role === 'tool')) {
      const owner = fitted.find((m) => m.role === 'assistant' && m.toolCalls?.some((tc) => tc.id === result.toolCallId));
      expect(owner).toBeDefined();
    }
  });

  it('leaves a short conversation untouched', async () => {
    const { fitToContext } = await import('../../src/adapters/plymaxx-llm.js');
    const messages = [
      { role: 'system' as const, content: 'persona' },
      { role: 'user' as const, content: 'नमस्ते' },
    ];
    const { messages: fitted, droppedCount } = fitToContext(messages, 256, 0);
    expect(droppedCount).toBe(0);
    expect(fitted).toHaveLength(2);
  });
});

describe('PlymaxxTtsAdapter model and voice selection', () => {
  it('uses the real Piper checkpoints for Hindi and Gujarati', async () => {
    const { PlymaxxTtsAdapter } = await import('../../src/adapters/plymaxx-tts.js');
    const adapter = new PlymaxxTtsAdapter();

    fetchMock.mockResolvedValueOnce(pcmResponse(500));
    await adapter.synthesize('नमस्ते', 'hi');
    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE}/audio/speech`);
    // Divya/Neha are aliases onto these two checkpoints, not separate voices.
    expect(lastRequestBody()).toMatchObject({ model: 'piper', voice: 'piper-hi-rohan', language: 'hi', response_format: 'pcm' });

    fetchMock.mockResolvedValueOnce(pcmResponse(500));
    await adapter.synthesize('નમસ્તે', 'gu');
    expect(lastRequestBody()).toMatchObject({ model: 'piper', voice: 'piper-gu-male', language: 'gu' });
  });

  it('speaks English with a Parler voice on the GPU, not a paid vendor', async () => {
    const { PlymaxxTtsAdapter } = await import('../../src/adapters/plymaxx-tts.js');
    fetchMock.mockResolvedValueOnce(pcmResponse(500, 44_100));

    await new PlymaxxTtsAdapter().synthesize('Hello there', 'en');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastRequestBody()).toMatchObject({ model: 'indic-parler-tts', voice: 'Thoma', language: 'en' });
  });

  it('honours a per-deployment model and voice override', async () => {
    vi.stubEnv('AI_TTS_MODEL_EN', 'indic-parler-tts');
    vi.stubEnv('AI_TTS_VOICE_EN', 'Mary');
    vi.resetModules();
    const { PlymaxxTtsAdapter } = await import('../../src/adapters/plymaxx-tts.js');
    fetchMock.mockResolvedValueOnce(pcmResponse(500, 44_100));

    await new PlymaxxTtsAdapter().synthesize('Hello there', 'en');
    expect(lastRequestBody()).toMatchObject({ voice: 'Mary' });
  });

  it('wraps raw PCM in a WAV container at the rate the server declared', async () => {
    const { PlymaxxTtsAdapter } = await import('../../src/adapters/plymaxx-tts.js');
    // Parler is 44.1 kHz and Piper is 22.05 kHz — the rate must come from the
    // response header, never a constant.
    fetchMock.mockResolvedValueOnce(pcmResponse(1_000, 44_100));
    const wav = await new PlymaxxTtsAdapter().synthesize('Hello there', 'en');

    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(44_100);
    expect(wav.readUInt16LE(22)).toBe(1);
  });

  it('returns silence for empty text instead of crashing the telephony path', async () => {
    const { PlymaxxTtsAdapter } = await import('../../src/adapters/plymaxx-tts.js');
    const adapter = new PlymaxxTtsAdapter();

    await expect(adapter.synthesizeMulaw8k('   ', 'hi')).resolves.toHaveLength(0);
    const streamed: Buffer[] = [];
    for await (const chunk of adapter.synthesizeMulaw8kStream('   ', 'hi')) streamed.push(chunk);
    expect(streamed).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('splits a long reply into ordered requests within the 400-character limit', async () => {
    const { splitForSynthesis } = await import('../../src/adapters/plymaxx-tts.js');
    const sentence = 'यह एक लंबा वाक्य है जिसमें बहुत सारे शब्द हैं। ';
    const chunks = splitForSynthesis(sentence.repeat(30));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(400);
    expect(chunks.join(' ').replace(/\s+/g, '')).toBe(sentence.repeat(30).replace(/\s+/g, ''));
  });

  it('breaks a single over-long sentence that has no punctuation', async () => {
    const { splitForSynthesis } = await import('../../src/adapters/plymaxx-tts.js');
    const chunks = splitForSynthesis('word '.repeat(200));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(400);
  });

  it('streams mu-law and aborts the upstream request when the caller barges in', async () => {
    const { PlymaxxTtsAdapter } = await import('../../src/adapters/plymaxx-tts.js');

    let captured: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: { signal?: AbortSignal }) => {
      captured = init.signal;
      const pcm = Buffer.alloc(4_000 * 2);
      for (let i = 0; i < 4_000; i++) pcm.writeInt16LE(5_000, i * 2);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let offset = 0; offset < pcm.length; offset += 900) {
            controller.enqueue(new Uint8Array(pcm.subarray(offset, Math.min(offset + 900, pcm.length))));
          }
          controller.close();
        },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'X-Audio-Sample-Rate': '22050', 'X-Audio-Format': 'pcm_s16le' } }));
    });

    let first: Buffer | undefined;
    for await (const chunk of new PlymaxxTtsAdapter().synthesizeMulaw8kStream('नमस्ते दोस्त', 'hi')) {
      first = chunk;
      break; // barge-in: abandoning the generator must run its finally block
    }

    expect(first!.length).toBeGreaterThan(0);
    expect(captured?.aborted).toBe(true);
  });

  it('converts both model sample rates to 8 kHz telephony audio', async () => {
    const { PlymaxxTtsAdapter } = await import('../../src/adapters/plymaxx-tts.js');
    // 22050/8000 and 44100/8000 are both non-integer ratios.
    for (const [rate, language] of [[22_050, 'hi'], [44_100, 'en']] as const) {
      fetchMock.mockReset();
      fetchMock.mockImplementation(() => {
        const pcm = Buffer.alloc(rate * 2); // exactly one second
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(pcm));
            controller.close();
          },
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { 'X-Audio-Sample-Rate': String(rate) } }));
      });

      let total = 0;
      for await (const chunk of new PlymaxxTtsAdapter().synthesizeMulaw8kStream('नमस्ते', language)) total += chunk.length;
      expect(Math.abs(total - 8_000)).toBeLessThanOrEqual(2);
    }
  });
});

describe('plymaxx client error mapping', () => {
  it('classifies the statuses the adapters have to react to', async () => {
    const { plymaxxFetch, PlymaxxRequestError } = await import('../../src/adapters/plymaxx-client.js');
    const cases: { status: number; kind: string; headers?: Record<string, string> }[] = [
      { status: 401, kind: 'auth' },
      { status: 422, kind: 'input' },
      { status: 429, kind: 'busy', headers: { 'Retry-After': '2' } },
      { status: 503, kind: 'upstream' },
    ];

    for (const testCase of cases) {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'nope' } }), { status: testCase.status, headers: testCase.headers }),
      );
      const error = await plymaxxFetch({
        adapterName: 'test',
        url: '/chat/completions',
        body: '{}',
        jsonContentType: true,
        timeoutMs: 5_000,
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PlymaxxRequestError);
      expect((error as InstanceType<typeof PlymaxxRequestError>).kind).toBe(testCase.kind);
      if (testCase.status === 429) {
        expect((error as InstanceType<typeof PlymaxxRequestError>).retryAfterSeconds).toBe(2);
      }
    }
  });

  it('bounds a stalled response body instead of hanging the turn', async () => {
    const { plymaxxFetchJson } = await import('../../src/adapters/plymaxx-client.js');
    // Headers arrive, then the body never completes.
    fetchMock.mockImplementation((_url: string, init: { signal?: AbortSignal }) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"text":'));
          init.signal?.addEventListener('abort', () => {
            try {
              controller.error(new Error('aborted'));
            } catch {
              /* already closed */
            }
          });
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });

    await expect(
      plymaxxFetchJson({ adapterName: 'test', url: '/x', body: '{}', jsonContentType: true, timeoutMs: 150 }),
    ).rejects.toThrow(/stalled beyond 150ms|aborted/);
  });

  it('reports a clear configuration error instead of sending an unauthenticated request', async () => {
    vi.stubEnv('AI_BASE_URL', '');
    vi.stubEnv('AI_API_KEY', '');
    vi.resetModules();
    const { PlymaxxLLMAdapter } = await import('../../src/adapters/plymaxx-llm.js');

    await expect(new PlymaxxLLMAdapter().chatWithTools([{ role: 'user', content: 'hi' }], [])).rejects.toThrow(
      /AI_BASE_URL\/AI_API_KEY are unset/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
