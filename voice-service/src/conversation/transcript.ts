import type { TranscriptionResult } from '../adapters/types.js';

const SUPPORTED_LANGUAGE_CODES = new Set(['en-IN', 'hi-IN', 'gu-IN']);
const MAX_TRANSCRIPT_CHARS = 1_000;

export type TranscriptDecision =
  | { accepted: true; text: string }
  | { accepted: false; reason: 'empty' | 'unsupported_language' | 'unsupported_script' | 'no_speech_content' | 'prompt_leakage' | 'filler_only' };

// OpenAI/Sarvam can occasionally repeat their transcription prompt when the
// audio contains only line noise or echo. These phrases are server-authored,
// never caller input, so allowing them into conversation history can change
// the language and corrupt the checkout state.
const TRANSCRIPTION_PROMPT_LEAKAGE =
  /\b(?:an earthora farms ordering call|transcribe only audible speech|short answers,? quantities and indian place names|do not complete fragments|invent speech during silence)\b|Earthora Farms का ऑर्डर कॉल|कही गई बात ही लिखें|चुप्पी में शब्द न जोड़ें|Earthora Farms નો ઓર્ડર કોલ|સાંભળેલી વાત જ લખો|મૌનમાં શબ્દો ન ઉમેરો/iu;

const FILLER_ONLY = /^(?:u+m+|u+h+|h+m+|m+h+m+|erm+|ah+|हम्म+|ह्म्म+|अम्म+|उम्म+|હમ્+|અમ્+)[.!?।,\s]*$/iu;

function containsUnsupportedLetter(text: string): boolean {
  for (const char of text) {
    if (!/\p{L}/u.test(char)) continue;
    if (/[A-Za-z\u0900-\u097F\u0A80-\u0AFF]/u.test(char)) continue;
    return true;
  }
  return false;
}

/**
 * Fail-closed validation shared by every voice transport. Sarvam can turn
 * background telephony noise into fluent-looking text in an unrelated
 * language; unsupported language/script output must never reach the LLM.
 */
export function normalizeVoiceTranscript(result: TranscriptionResult): TranscriptDecision {
  const detectedCode = result.detectedLanguageCode?.trim();
  if (detectedCode && !SUPPORTED_LANGUAGE_CODES.has(detectedCode)) {
    return { accepted: false, reason: 'unsupported_language' };
  }

  let text = result.text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!text) return { accepted: false, reason: 'empty' };
  if (TRANSCRIPTION_PROMPT_LEAKAGE.test(text)) return { accepted: false, reason: 'prompt_leakage' };
  if (FILLER_ONLY.test(text)) return { accepted: false, reason: 'filler_only' };
  if (containsUnsupportedLetter(text)) return { accepted: false, reason: 'unsupported_script' };
  if (!/[\p{L}\p{N}]/u.test(text)) return { accepted: false, reason: 'no_speech_content' };

  text = text
    .replace(/\b(?:a(?:r)?thora|ertora|earth\s*aura)\s+(?:farms?|firms?)\b/gi, 'Earthora Farms')
    .replace(/\b(?:a(?:r)?thora|ertora)\b/gi, 'Earthora')
    .slice(0, MAX_TRANSCRIPT_CHARS)
    .trim();

  return { accepted: true, text };
}
