// Vendor-neutral provider factories — the ONE place a vendor is named, per
// capability. Everything downstream (conversation/controller.ts, a future
// audio pipeline) talks only to the LLMAdapter/SttAdapter/TtsAdapter
// interfaces in adapters/types.ts and adapters/google-stt.ts/google-tts.ts,
// never to an OpenAI/Sarvam/Google SDK directly. Swapping a provider is an
// env var change (LLM_PROVIDER/STT_PROVIDER/TTS_PROVIDER) plus adding one
// class here — not a refactor of the conversation engine.

import { config } from './config.js';
import type { ConversationMessage } from './conversation/state.js';
import type { SupportedLanguage } from './conversation/language.js';
import type { LLMAdapter, LLMTurnResult } from './adapters/types.js';
import type { ToolDefinition } from './tools/types.js';
import type { SttAdapter, TtsAdapter } from './adapters/types.js';
import { OpenAiLLMAdapter } from './adapters/openai.js';
import { OpenAiSttAdapter } from './adapters/openai-stt.js';
import { OpenAiTtsAdapter } from './adapters/openai-tts.js';
import { SarvamLLMAdapter } from './adapters/sarvam.js';
import { SarvamSttAdapter } from './adapters/sarvam-stt.js';
import { SarvamTtsAdapter } from './adapters/sarvam-tts.js';
import { GoogleSttAdapter } from './adapters/google-stt.js';
import { GoogleTtsAdapter } from './adapters/google-tts.js';
import { PlymaxxLLMAdapter } from './adapters/plymaxx-llm.js';
import { PlymaxxSttAdapter } from './adapters/plymaxx-stt.js';
import { PlymaxxTtsAdapter } from './adapters/plymaxx-tts.js';

// Constructed lazily, at most once each, regardless of how many times a
// factory below is called — cheap to call chatWithRouting() every turn.
let openaiSingleton: OpenAiLLMAdapter | null = null;
let openaiSttSingleton: OpenAiSttAdapter | null = null;
let openaiTtsSingleton: OpenAiTtsAdapter | null = null;
let sarvamSingleton: SarvamLLMAdapter | null = null;
let sarvamSttSingleton: SarvamSttAdapter | null = null;
let sarvamTtsSingleton: SarvamTtsAdapter | null = null;
let plymaxxSingleton: PlymaxxLLMAdapter | null = null;
let plymaxxSttSingleton: PlymaxxSttAdapter | null = null;
let plymaxxTtsSingleton: PlymaxxTtsAdapter | null = null;

function getOpenAiStt(): OpenAiSttAdapter {
  if (!openaiSttSingleton) openaiSttSingleton = new OpenAiSttAdapter();
  return openaiSttSingleton;
}
function getOpenAiTts(): OpenAiTtsAdapter {
  if (!openaiTtsSingleton) openaiTtsSingleton = new OpenAiTtsAdapter();
  return openaiTtsSingleton;
}
function getSarvamTts(): SarvamTtsAdapter {
  if (!sarvamTtsSingleton) sarvamTtsSingleton = new SarvamTtsAdapter();
  return sarvamTtsSingleton;
}

function getOpenAi(): OpenAiLLMAdapter {
  if (!openaiSingleton) openaiSingleton = new OpenAiLLMAdapter();
  return openaiSingleton;
}
function getSarvam(): SarvamLLMAdapter {
  if (!sarvamSingleton) sarvamSingleton = new SarvamLLMAdapter();
  return sarvamSingleton;
}

// Self-hosted GPU server. Every capability and every language this product
// speaks is served there, so none of these adapters takes a paid fallback:
// choosing 'plymaxx' means the GPU, and a GPU failure surfaces rather than
// silently billing a vendor. TTS_PROVIDER=auto remains the hosted option.
function getPlymaxx(): PlymaxxLLMAdapter {
  if (!plymaxxSingleton) plymaxxSingleton = new PlymaxxLLMAdapter();
  return plymaxxSingleton;
}
function getPlymaxxStt(): PlymaxxSttAdapter {
  if (!plymaxxSttSingleton) plymaxxSttSingleton = new PlymaxxSttAdapter();
  return plymaxxSttSingleton;
}
function getPlymaxxTts(): PlymaxxTtsAdapter {
  if (!plymaxxTtsSingleton) plymaxxTtsSingleton = new PlymaxxTtsAdapter();
  return plymaxxTtsSingleton;
}

export function buildLLM(): LLMAdapter {
  switch (config.LLM_PROVIDER) {
    case 'openai':
      return getOpenAi();
    case 'sarvam':
      return getSarvam();
    case 'plymaxx':
      return getPlymaxx();
    case 'auto':
      // 'auto' needs a per-turn language to route on — see
      // chatWithRouting(), which conversation/controller.ts actually calls
      // instead of buildLLM() when LLM_PROVIDER=auto. This branch only
      // exists so a stray buildLLM() call fails loudly instead of silently
      // picking one provider.
      throw new Error('LLM_PROVIDER=auto requires per-turn routing — call chatWithRouting(...) instead.');
    default:
      throw new Error(`Unknown LLM_PROVIDER "${config.LLM_PROVIDER}".`);
  }
}

/**
 * The actual per-turn call site conversation/controller.ts uses. In 'auto'
 * mode for a non-English turn, a Sarvam failure (rate limit, billing lapse,
 * network error — anything) falls back to OpenAI for THIS call rather than
 * breaking the caller's turn. The SAME language instruction stays in the
 * request when falling back; output-policy checks the returned script.
 * Every other mode calls its single configured provider with no
 * fallback — an explicit single-provider choice should fail loudly, not
 * silently substitute a different vendor.
 */
export async function chatWithRouting(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  language: SupportedLanguage
): Promise<LLMTurnResult> {
  if (config.LLM_PROVIDER !== 'auto') {
    return buildLLM().chatWithTools(messages, tools);
  }

  if (language !== 'en') {
    try {
      // eslint-disable-next-line no-console
      console.log(`[providers] routing turn to Sarvam (language=${language})`);
      return await getSarvam().chatWithTools(messages, tools);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[providers] Sarvam call failed, falling back to OpenAI for this turn: ${(err as Error).message}`
      );
    }
  }

  return getOpenAi().chatWithTools(messages, tools);
}

export function buildStt(): SttAdapter {
  switch (config.STT_PROVIDER) {
    case 'openai':
      return getOpenAiStt();
    case 'sarvam':
      if (!sarvamSttSingleton) sarvamSttSingleton = new SarvamSttAdapter();
      return sarvamSttSingleton;
    case 'plymaxx':
      // Picks the recognition model per utterance from opts.languageHint:
      // Gujarati → IndicConformer, English/Hindi → Whisper, and Whisper's
      // auto-detection when the language is not yet known. buildStt() has no
      // language to switch on, so the adapter does it.
      return getPlymaxxStt();
    case 'google':
      return new GoogleSttAdapter();
    default:
      throw new Error(`Unknown STT_PROVIDER "${config.STT_PROVIDER}".`);
  }
}

export function buildTts(): TtsAdapter {
  switch (config.TTS_PROVIDER) {
    case 'sarvam':
      if (!sarvamTtsSingleton) sarvamTtsSingleton = new SarvamTtsAdapter();
      return sarvamTtsSingleton;
    case 'openai':
      return getOpenAiTts();
    case 'plymaxx':
      // Picks the synthesis model per reply: Piper for Hindi/Gujarati
      // (streams, low latency) and Parler for English (68 named speakers, but
      // completed audio, so it starts speaking later).
      return getPlymaxxTts();
    case 'google':
      return new GoogleTtsAdapter();
    case 'auto':
      // 'auto' needs the language of the current reply — buildTts() doesn't
      // have that; callers that want per-language routing must call
      // buildTtsForLanguage(language) instead. This branch only exists so a
      // stray buildTts() call fails loudly rather than silently picking one.
      throw new Error('TTS_PROVIDER=auto requires per-language routing — call buildTtsForLanguage(language) instead.');
    default:
      throw new Error(`Unknown TTS_PROVIDER "${config.TTS_PROVIDER}".`);
  }
}

/**
 * Returns the right TTS adapter for the given language.
 * In TTS_PROVIDER=auto mode: English → OpenAI TTS (nova, much better
 * English quality), Hindi/Gujarati → Sarvam TTS (bulbul:v3, purpose-built
 * for Indic languages). Any other TTS_PROVIDER value ignores the language
 * and delegates to buildTts() which reads the configured provider directly.
 */
export function buildTtsForLanguage(language: SupportedLanguage): TtsAdapter {
  if (config.TTS_PROVIDER !== 'auto') {
    return buildTts();
  }
  if (language === 'en') {
    return getOpenAiTts();
  }
  // Indic languages prefer Sarvam, but an exhausted/missing Sarvam account
  // must not make the call silent. OpenAI TTS is a degraded-voice fallback.
  return {
    async synthesize(text, replyLanguage) {
      try {
        return await getSarvamTts().synthesize(text, replyLanguage);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[providers] Sarvam TTS failed; using OpenAI TTS: ${(err as Error).message}`);
        return getOpenAiTts().synthesize(text, replyLanguage);
      }
    },
    async synthesizeMulaw8k(text, replyLanguage) {
      try {
        return await getSarvamTts().synthesizeMulaw8k(text, replyLanguage);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[providers] Sarvam telephony TTS failed; using OpenAI TTS: ${(err as Error).message}`);
        return getOpenAiTts().synthesizeMulaw8k(text, replyLanguage);
      }
    },
    async *synthesizeMulaw8kStream(text, replyLanguage) {
      let emittedAudio = false;
      try {
        for await (const chunk of getSarvamTts().synthesizeMulaw8kStream(text, replyLanguage)) {
          emittedAudio = true;
          yield chunk;
        }
      } catch (err) {
        // Falling back before any bytes are played is seamless. Once audio
        // has started, changing vendors would audibly change the speaker in
        // the same sentence, so surface the partial-stream failure instead.
        if (emittedAudio) throw err;
        // eslint-disable-next-line no-console
        console.warn(`[providers] Sarvam streaming TTS failed; using OpenAI TTS: ${(err as Error).message}`);
        yield* getOpenAiTts().synthesizeMulaw8kStream(text, replyLanguage);
      }
    },
  };
}
