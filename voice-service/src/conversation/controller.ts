import type { ConversationState, ConversationMessage } from './state.js';
import { SYSTEM_PROMPT } from './prompt.js';
import { WHATSAPP_SYSTEM_PROMPT } from './whatsapp-prompt.js';
import { enforceOutputPolicy } from './output-policy.js';
import { limitSpokenReply, toSpokenText } from './speech-format.js';
import { detectLanguage, buildLanguageInstruction } from './language.js';
import { turnFailurePrompt } from './voice-copy.js';
import { buildCheckoutTurnInstruction } from './checkout-context.js';
import { chatWithRouting } from '../providers.js';
import { allTools, toolsByName } from '../tools/index.js';

const MAX_TOOL_LOOP_ITERATIONS = 6;
// guard.py-style two-strike system: 1 regenerate attempt, then fallback.
const MAX_POLICY_REGENERATE_ATTEMPTS = 1;

export function shouldPrefetchProductCatalog(text: string): boolean {
  return /\b(products?|available|availability|stock|sell|selling|catalog(?:ue)?)\b|प्रोडक्ट|उत्पाद|अवेलेबल|उपलब्ध|स्टॉक|પ્રોડક્ટ|ઉપલબ્ધ|સ્ટોક/iu.test(text);
}

export interface TurnOutcome {
  state: ConversationState;
  replyText: string;
  policyViolations: string[];
}

/**
 * Runs one full conversational turn: user text in, zero or more tool calls,
 * final text out. This is the ONLY place tool calls happen, and the ONLY
 * place `output-policy.ts` is applied — every reply that ever reaches a
 * caller (text-mode today, TTS later) goes through here.
 */
export async function processTurn(
  callSessionId: string,
  state: ConversationState,
  userText: string,
  channel: 'voice' | 'text' = 'voice'
): Promise<TurnOutcome> {
  state.turnCount += 1;
  // Cleared every turn — see conversation/state.ts TurnToolFact doc comment.
  // A fact from a previous turn is not a fact the model may rely on; it
  // must call the tool again this turn.
  state.currentTurnFacts = [];

  state.messages.push({ role: 'user', content: userText });

  // Deterministic, per-turn — see conversation/language.ts. Only updates
  // state.currentLanguage when detection is confident; an ambiguous turn
  // (e.g. a bare "yes") keeps whatever language the conversation already
  // settled into.
  // Language is locked once checkout field collection begins: short answers
  // like city names ("Ahmedabad") or PIN codes are ambiguous and would
  // incorrectly flip the conversation language mid-checkout.
  const checkoutStarted = Object.keys(state.checkoutFields).length > 0;
  if (!checkoutStarted) {
    const detected = detectLanguage(userText);
    if (detected) state.currentLanguage = detected;
  }

  // The language instruction is folded into the PRIMARY system message,
  // rebuilt fresh every turn from state.currentLanguage — not pushed as a
  // separate system-role message into state.messages. Empirically, a
  // secondary system message interleaved after user/assistant history gets
  // followed inconsistently; the same lesson is documented in the reference
  // pathology-bot project (some LLMs deprioritize a system message that
  // isn't the first one). Rebuilding it every turn (not just on turns where
  // detection fired) also means an ambiguous turn ("yes") still reinforces
  // "keep replying in the current language" rather than only mentioning it
  // once and hoping it sticks.
  // Placed FIRST, not appended after the long rules block — a short,
  // high-priority directive at the top of the system message is followed
  // more reliably than the same instruction buried after several hundred
  // words of other rules (primacy beat recency in testing against this
  // model for this prompt length).
  const basePrompt = channel === 'text' ? WHATSAPP_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const checkoutInstruction = buildCheckoutTurnInstruction(state);
  const systemMessage: ConversationMessage = {
    role: 'system',
    content:
      `${buildLanguageInstruction(state.currentLanguage)}` +
      (checkoutInstruction ? `\n\n${checkoutInstruction}` : '') +
      `\n\n${basePrompt}`,
  };
  const toolDefs = allTools.map((t) => t.definition);

  // Availability questions are common and safety-critical. Production calls
  // showed that the model sometimes repeated a catalog answer from history
  // without making the mandatory fresh list_products call; output-policy
  // correctly blocked it, but the caller then heard an unhelpful deflection.
  // Preload the live catalog deterministically for obvious product questions
  // so both the answer and the safety policy have same-turn grounding.
  const turnContextMessages: ConversationMessage[] = [];
  const preloadedToolResults = new Map<string, unknown>();
  if (shouldPrefetchProductCatalog(userText)) {
    const listTool = toolsByName.list_products;
    if (listTool) {
      let productCatalog: unknown;
      try {
        productCatalog = await listTool.handler({ query: null }, { callSessionId, state });
      } catch (err) {
        productCatalog = { error: 'tool_execution_failed', message: (err as Error).message };
      }
      const resultJson = JSON.stringify(productCatalog);
      state.currentTurnFacts.push({ toolName: 'list_products', resultJson });
      preloadedToolResults.set('list_products:{"query":null}', productCatalog);
      turnContextMessages.push({
        role: 'system',
        content:
          `LIVE PRODUCT CATALOG FOR THIS TURN (already fetched with list_products): ${resultJson}. ` +
          'Use it directly for catalog, availability, and product-name resolution. For benefits, dosage, ' +
          'ingredients, directions, or warnings, still call get_product_knowledge with the matching product ID.',
      });
    }
  }

  // Turn-scoped only (local, not persisted): if the model calls the same
  // tool with identical arguments twice within one turn's tool-loop, reuse
  // the first result instead of re-querying Supabase. Mirrors the old
  // prototype's per-turn tool-result cache; safe because tool results are
  // already small/curated (see tools/*.ts), not raw DB rows that would need
  // separate compaction.
  const turnCallCache = new Map<string, unknown>();
  for (const [key, value] of preloadedToolResults) turnCallCache.set(key, value);
  let regenerateAttempts = 0;
  let transientCorrection: ConversationMessage | null = null;

  for (let iteration = 0; iteration < MAX_TOOL_LOOP_ITERATIONS; iteration++) {
    // Per-turn provider selection — see providers.ts. In LLM_PROVIDER=auto,
    // this is what actually routes Hindi/Gujarati to Sarvam and English to
    // OpenAI (with a same-turn fallback to OpenAI if Sarvam errors).
    const result = await chatWithRouting(
      [systemMessage, ...turnContextMessages, ...state.messages, ...(transientCorrection ? [transientCorrection] : [])],
      toolDefs,
      state.currentLanguage
    );

    if (result.kind === 'tool_calls') {
      state.messages.push({
        role: 'assistant',
        content: '',
        toolCalls: result.calls.map((c) => ({ id: c.id, name: c.name, argumentsJson: c.argumentsJson })),
      });

      for (const call of result.calls) {
        const cacheKey = `${call.name}:${call.argumentsJson}`;
        let resultObj: unknown;

        if (turnCallCache.has(cacheKey)) {
          resultObj = turnCallCache.get(cacheKey);
        } else {
          const toolModule = toolsByName[call.name];
          if (!toolModule) {
            resultObj = { error: 'unknown_tool' };
          } else {
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = call.argumentsJson ? JSON.parse(call.argumentsJson) : {};
            } catch {
              parsedArgs = {};
            }
            try {
              resultObj = await toolModule.handler(parsedArgs, { callSessionId, state });
            } catch (err) {
              resultObj = { error: 'tool_execution_failed', message: (err as Error).message };
            }
          }
          turnCallCache.set(cacheKey, resultObj);
        }

        const resultJson = JSON.stringify(resultObj);
        state.currentTurnFacts.push({ toolName: call.name, resultJson });
        state.messages.push({ role: 'tool', content: resultJson, toolCallId: call.id, toolName: call.name });
      }

      continue; // let the model see the tool results and respond
    }

    // Final assistant message candidate for this turn.
    const policyResult = enforceOutputPolicy(result.content, state.currentTurnFacts, callSessionId, state.currentLanguage);

    if (policyResult.action === 'regenerate' && regenerateAttempts < MAX_POLICY_REGENERATE_ATTEMPTS) {
      regenerateAttempts++;
      // eslint-disable-next-line no-console
      console.warn('[output-policy] regenerating turn:', policyResult.violations);
      // Turn-local only: never persist a correction into future conversation
      // history, where it can distort unrelated later turns.
      transientCorrection = { role: 'system', content: `[Correction] ${policyResult.instruction}` };
      continue;
    }

    if (policyResult.violations.length > 0) {
      // eslint-disable-next-line no-console
      console.warn('[output-policy] violations this turn:', policyResult.violations);
    }
    // Every reply is spoken (TTS) or read in a text harness meant to mirror
    // the voice experience — strip markdown artifacts before it ever leaves
    // this function. See speech-format.ts for why the prompt alone isn't
    // enough.
    const finalText = channel === 'voice'
      ? limitSpokenReply(toSpokenText(policyResult.text))
      : policyResult.text;
    state.messages.push({ role: 'assistant', content: finalText });
    return { state, replyText: finalText, policyViolations: policyResult.violations };
  }

  const fallback = turnFailurePrompt(state.currentLanguage);
  state.messages.push({ role: 'assistant', content: fallback });
  return { state, replyText: fallback, policyViolations: ['tool_loop_guard_exceeded'] };
}
