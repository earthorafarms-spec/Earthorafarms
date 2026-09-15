import { config } from '../../config.js';
import { openaiEmbedding, openaiLlm, openaiStt, openaiTts } from './openai.js';
import { geminiEmbedding, geminiLlm, googleAvailable } from './google.js';
import type { EmbeddingAdapter, LlmAdapter, SttAdapter, TtsAdapter } from './types.js';

export type ProviderName = 'openai' | 'gemini' | 'auto';

/** Resolve the LLM for a channel/workflow. Default is OpenAI (works today); 'gemini' when the project is enabled. */
export function getLlm(pref?: ProviderName): LlmAdapter {
  if (pref === 'gemini' && googleAvailable()) return geminiLlm;
  return openaiLlm;
}

/** Embedding model is fixed per KB once indexed. Launch default: OpenAI 1536. */
export function getEmbedding(pref?: ProviderName): EmbeddingAdapter {
  if (pref === 'gemini' && googleAvailable()) return geminiEmbedding;
  return openaiEmbedding;
}

export function getStt(_pref?: ProviderName): SttAdapter { return openaiStt; }
export function getTts(_pref?: ProviderName): TtsAdapter { return openaiTts; }

export function providerStatus() {
  return {
    llm: { openai: Boolean(config.OPENAI_API_KEY), gemini: googleAvailable() },
    embedding: { openai: Boolean(config.OPENAI_API_KEY), gemini: googleAvailable() },
    speech: { openai: Boolean(config.OPENAI_API_KEY), google_cloud: Boolean(config.GOOGLE_APPLICATION_CREDENTIALS_JSON) },
    default_llm: 'openai',
    default_embedding: `${openaiEmbedding.model} (${openaiEmbedding.dims}d)`,
  };
}

export type { LlmAdapter, EmbeddingAdapter, SttAdapter, TtsAdapter };
