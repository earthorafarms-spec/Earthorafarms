import { processTurn } from '../conversation/controller.js';
import { getCallSession, updateCallSessionState } from '../repositories/callSessions.repository.js';
import type { SupportedLanguage } from '../conversation/language.js';

export interface BrowserMessageResult {
  replyText: string;
  /** The conversation's language AFTER this turn — used by routes/voice.ts to pick the TTS voice for the reply. */
  language: SupportedLanguage;
  /** True when create_verification_link succeeded this turn — caller should end the call after audio finishes. */
  callShouldEnd: boolean;
}

// The real, working transport: plain text in, plain text out, over HTTP
// (see routes/voice.ts's /message route for typed text, /audio-message for
// real voice). Both routes call this exact same function — a real audio
// adapter (STT -> this function -> TTS) is not a special case, it's just
// text transcribed from speech going through the identical pipeline text
// input already uses. The conversation controller never needs to know
// whether the text originated from typing or from speech recognition.
export async function processBrowserMessage(callSessionId: string, text: string): Promise<BrowserMessageResult> {
  const session = await getCallSession(callSessionId);
  if (!session) {
    throw new Error('Unknown call session');
  }

  const outcome = await processTurn(callSessionId, session.conversationState, text);
  await updateCallSessionState(callSessionId, outcome.state);

  const callShouldEnd = outcome.state.currentTurnFacts.some((f) => {
    if (f.toolName !== 'create_verification_link') return false;
    try { return (JSON.parse(f.resultJson) as { ok?: boolean })?.ok === true; } catch { return false; }
  });

  return { replyText: outcome.replyText, language: outcome.state.currentLanguage, callShouldEnd };
}
