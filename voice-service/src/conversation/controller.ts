import type { ConversationState, ConversationMessage } from './state.js';
import { SYSTEM_PROMPT } from './prompt.js';
import { WHATSAPP_SYSTEM_PROMPT } from '../../../whatsapp-chatbot/prompt.js';
import { enforceOutputPolicy } from './output-policy.js';
import { limitSpokenReply, toSpokenText } from './speech-format.js';
import { detectLanguage, requestedLanguage, buildLanguageInstruction } from './language.js';
import { turnFailurePrompt } from './voice-copy.js';
import { buildCheckoutTurnInstruction } from './checkout-context.js';
import { chatWithRouting } from '../providers.js';
import { allTools, toolsByName } from '../tools/index.js';
import { isCheckoutReady } from '../tools/checkout.js';

function reviewFormReply(sent: boolean, language: ConversationState['currentLanguage']): string {
  if (sent) {
    if (language === 'hi') return 'आपके WhatsApp पर ऑर्डर रिव्यू फॉर्म भेज दिया है। उसमें जानकारी चेक या बदलकर कन्फर्म करें, उसके बाद ही Razorpay पेमेंट कर सकते हैं।';
    if (language === 'gu') return 'તમારા WhatsApp પર ઓર્ડર રિવ્યુ ફોર્મ મોકલ્યું છે. વિગતો તપાસીને કે બદલીને કન્ફર્મ કરો, ત્યાર પછી જ Razorpay પેમેન્ટ કરી શકશો.';
    return 'I’ve sent the order-review form to your WhatsApp. Please review or edit your details and confirm the form before continuing to Razorpay payment.';
  }
  if (language === 'hi') return 'माफ़ कीजिए, अभी WhatsApp पर फॉर्म नहीं भेज पाई। आपका ऑर्डर या पेमेंट नहीं हुआ है; क्या आप फिर कोशिश करना चाहेंगे?';
  if (language === 'gu') return 'માફ કરશો, અત્યારે WhatsApp પર ફોર્મ મોકલી શકી નથી. તમારો ઓર્ડર કે પેમેન્ટ થયું નથી; ફરી પ્રયત્ન કરવો છે?';
  return 'Sorry, I couldn’t send the WhatsApp form. No order or payment has been completed; would you like me to try again?';
}

const MAX_TOOL_LOOP_ITERATIONS = 6;
// guard.py-style two-strike system: 1 regenerate attempt, then fallback.
const MAX_POLICY_REGENERATE_ATTEMPTS = 1;

export function shouldPrefetchProductCatalog(text: string): boolean {
  return /\b(products?|available|availability|stock|sell|selling|catalog(?:ue)?)\b|प्रोडक्ट|उत्पाद|अवेलेबल|उपलब्ध|स्टॉक|પ્રોડક્ટ|ઉપલબ્ધ|સ્ટોક/iu.test(text);
}

export function shouldAnswerCatalogDirectly(text: string): boolean {
  if (!shouldPrefetchProductCatalog(text)) return false;
  // Specific price, benefit, usage, and purchase questions still require
  // the normal tool/LLM loop. A plain "what do you sell?" does not: the live
  // list_products result is already the complete, grounded answer.
  return !/\b(price|cost|how much|benefits?|uses?|dosage|dose|ingredients?|directions?|warnings?|buy|order|add|want|need)\b|कीमत|दाम|फायदे|लाभ|खुराक|सामग्री|इस्तेमाल|खरीद|ऑर्डर|જાણકારી|કિંમત|ફાયદા|ઉપયોગ|ખરીદ|ઓર્ડર/iu.test(text);
}

function buildDirectCatalogReply(
  catalog: unknown,
  language: ConversationState['currentLanguage']
): string | null {
  if (!catalog || typeof catalog !== 'object') return null;
  const products = (catalog as { products?: unknown }).products;
  if (!Array.isArray(products)) return null;

  const names = products
    .map((product) => product && typeof product === 'object' ? (product as { name?: unknown }).name : null)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .map((name) => name.trim());

  if (names.length === 0) {
    if (language === 'hi') return 'अभी कोई प्रोडक्ट लिस्ट नहीं है। कृपया थोड़ी देर बाद फिर पूछें।';
    if (language === 'gu') return 'હમણાં કોઈ પ્રોડક્ટ લિસ્ટમાં નથી. કૃપા કરીને થોડી વાર પછી ફરી પૂછો.';
    return 'No products are listed right now. Please check again shortly.';
  }

  const spokenNames = names.slice(0, 4).join(', ');
  const remainder = names.length - 4;
  if (language === 'hi') {
    const more = remainder > 0 ? ` और ${remainder} प्रोडक्ट` : '';
    return `अभी हमारे प्रोडक्ट हैं: ${spokenNames}${more}। आप किस प्रोडक्ट की जानकारी चाहते हैं?`;
  }
  if (language === 'gu') {
    const more = remainder > 0 ? ` અને બીજી ${remainder} પ્રોડક્ટ` : '';
    return `હમણાં અમારી પ્રોડક્ટ છે: ${spokenNames}${more}. તમને કઈ પ્રોડક્ટની માહિતી જોઈએ છે?`;
  }
  const more = remainder > 0 ? `, plus ${remainder} more` : '';
  return `Our current products are ${spokenNames}${more}. Which one would you like to know about?`;
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
  const checkoutStarted = state.cart.length > 0 || Object.keys(state.checkoutFields).length > 0;
  const explicitLanguage = requestedLanguage(userText);
  if (explicitLanguage) {
    state.currentLanguage = explicitLanguage;
  } else if (!checkoutStarted) {
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

      if (shouldAnswerCatalogDirectly(userText)) {
        const directReply = buildDirectCatalogReply(productCatalog, state.currentLanguage);
        if (directReply) {
          const finalText = channel === 'voice'
            ? limitSpokenReply(toSpokenText(directReply))
            : directReply;
          state.messages.push({ role: 'assistant', content: finalText });
          return { state, replyText: finalText, policyViolations: [] };
        }
      }

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
    // Tools mutate the state during the loop. Never keep asking for a field
    // that was saved earlier in this same turn (especially city + state/GST).
    const liveCheckoutInstruction = buildCheckoutTurnInstruction(state);
    systemMessage.content = `${buildLanguageInstruction(state.currentLanguage)}\n\n` +
      (liveCheckoutInstruction ? `${liveCheckoutInstruction}\n\n` : '') + basePrompt;
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

      // After the last detail is saved, sending the review form is a workflow
      // step, not an optional model decision. Execute only after the entire
      // batch (including every cart change) and never twice in the same turn.
      const fieldSaved = result.calls.some((call) => ['set_checkout_field', 'set_delivery_location'].includes(call.name));
      if (fieldSaved && isCheckoutReady(state) && !state.currentTurnFacts.some((fact) => fact.toolName === 'create_verification_link')) {
        const callId = `review-${state.turnCount}-${iteration}`;
        state.messages.push({ role: 'assistant', content: '', toolCalls: [{ id: callId, name: 'create_verification_link', argumentsJson: '{}' }] });
        let delivery: unknown;
        try {
          delivery = await toolsByName.create_verification_link.handler({}, { callSessionId, state });
        } catch {
          delivery = { ok: false, reason: 'checkout_preparation_failed' };
        }
        const resultJson = JSON.stringify(delivery);
        state.currentTurnFacts.push({ toolName: 'create_verification_link', resultJson });
        state.messages.push({ role: 'tool', toolName: 'create_verification_link', toolCallId: callId, content: resultJson });
      }

      const deliveryFact = state.currentTurnFacts.find((fact) => fact.toolName === 'create_verification_link');
      if (deliveryFact) {
        const delivery = JSON.parse(deliveryFact.resultJson) as { ok?: boolean; reason?: string };
        // Missing fields still go through the model to ask the right question.
        if (delivery.ok || !['empty_cart', 'missing_fields', 'gst_question_not_answered', 'invalid_phone'].includes(delivery.reason ?? '')) {
          const replyText = reviewFormReply(delivery.ok === true, state.currentLanguage);
          state.messages.push({ role: 'assistant', content: replyText });
          return { state, replyText, policyViolations: [] };
        }
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
