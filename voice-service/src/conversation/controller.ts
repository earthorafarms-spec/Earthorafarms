import type { ConversationState, ConversationMessage } from './state.js';
import { SYSTEM_PROMPT } from './prompt.js';
import { WHATSAPP_MENU, WHATSAPP_SYSTEM_PROMPT } from '../../../whatsapp-chatbot/prompt.js';
import { enforceOutputPolicy } from './output-policy.js';
import { limitSpokenReply, normalizeIndicSpeechText, toSpokenText } from './speech-format.js';
import { detectLanguage, requestedLanguage, buildLanguageInstruction } from './language.js';
import { reviewReceivedPrompt, turnFailurePrompt } from './voice-copy.js';
import { buildCheckoutTurnInstruction } from './checkout-context.js';
import { chatWithRouting } from '../providers.js';
import { allTools, toolsByName } from '../tools/index.js';
import { isCheckoutReady } from '../tools/checkout.js';
import { spokenProductNameMatches } from '../tools/products.js';
import { getAllApprovedProductKnowledge } from '../tools/knowledge.js';
import type { OutboundAction, ToolContext } from '../tools/types.js';

function reviewFormReply(
  sent: boolean,
  language: ConversationState['currentLanguage'],
  reviewUrl?: string,
): string {
  if (sent) {
    if (reviewUrl) {
      if (language === 'hi') return `आपका ऑर्डर रिव्यू फॉर्म तैयार है:\n${reviewUrl}\n\nकृपया सामान और डिलीवरी की जानकारी जाँचें या बदलें, फिर फॉर्म कन्फर्म करें। अभी कोई पेमेंट या ऑर्डर पूरा नहीं हुआ है; कन्फर्म करने के बाद ही Razorpay खुलेगा।`;
      if (language === 'gu') return `તમારું ઓર્ડર રિવ્યૂ ફોર્મ તૈયાર છે:\n${reviewUrl}\n\nકૃપા કરીને વસ્તુઓ અને ડિલિવરીની વિગતો તપાસો અથવા બદલો, પછી ફોર્મ કન્ફર્મ કરો. હજી કોઈ પેમેન્ટ કે ઓર્ડર પૂર્ણ થયો નથી; કન્ફર્મ કર્યા પછી જ Razorpay ખુલશે.`;
      return `Your order-review form is ready:\n${reviewUrl}\n\nPlease check or edit the items and delivery details, then confirm the form. No order or payment has been completed yet; Razorpay opens only after your confirmation.`;
    }
    if (language === 'hi') return 'आपके WhatsApp पर ऑर्डर रिव्यू फॉर्म भेज दिया है। WhatsApp चेक करें और लिंक मिलने पर हाँ कहें। पेमेंट से पहले फॉर्म चेक या एडिट कर सकते हैं।';
    if (language === 'gu') return 'તમારા WhatsApp પર ઓર્ડર રિવ્યૂ ફોર્મ મોકલ્યું છે. WhatsApp તપાસો અને લિંક મળે પછી હા કહો. પેમેન્ટ પહેલાં ફોર્મ તપાસી અથવા બદલી શકો છો.';
    return 'I’ve sent the order-review form to your WhatsApp. Check WhatsApp and say yes once it arrives. You can review or edit the form before payment.';
  }
  if (language === 'hi') return 'माफ़ कीजिए, अभी WhatsApp पर फॉर्म नहीं भेज पाई। आपका ऑर्डर या पेमेंट नहीं हुआ है; क्या आप फिर कोशिश करना चाहेंगे?';
  if (language === 'gu') return 'માફ કરશો, અત્યારે WhatsApp પર ફોર્મ મોકલી શકી નથી. તમારો ઓર્ડર કે પેમેન્ટ થયું નથી; ફરી પ્રયત્ન કરવો છે?';
  return 'Sorry, I couldn’t send the WhatsApp form. No order or payment has been completed; would you like me to try again?';
}

const RECEIPT_CONFIRMATION_PATTERN =
  /\b(?:yes|yeah|yep|received|got it|i got|mil gaya|aa gaya)\b|हाँ|हां|मिल गया|आ गया|मिला है|હા|મળી ગઈ|મળી ગયો|આવી ગઈ|આવી ગયો/iu;
const RECEIPT_NEGATION_PATTERN =
  /\b(?:no|not|didn'?t|haven'?t|not received|did not receive)\b|नहीं|नही|નથી|નહીં/iu;

function confirmedReviewReceipt(text: string): boolean {
  return !RECEIPT_NEGATION_PATTERN.test(text) && RECEIPT_CONFIRMATION_PATTERN.test(text);
}

const CART_SUMMARY_PATTERN =
  /\b(?:my cart|cart total|what(?:'s| is) in (?:my )?cart|how many (?:bottles?|packs?|items?)|what did i add|my bill|bill total)\b|मेरे? कार्ट|कार्ट में|कितनी? (?:बॉटल|पैक|आइटम)|मेरा बिल|કાર્ટમાં|માર[ુંા] કાર્ટ|કેટલ[ાી] (?:બોટલ|પેક|આઇટમ)|મારું બિલ/iu;

const QUANTITY_WORDS: Record<ConversationState['currentLanguage'], string[]> = {
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'],
  hi: ['शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ', 'दस'],
  gu: ['શૂન્ય', 'એક', 'બે', 'ત્રણ', 'ચાર', 'પાંચ', 'છ', 'સાત', 'આઠ', 'નવ', 'દસ'],
};

function spokenQuantity(quantity: number, language: ConversationState['currentLanguage']): string {
  return QUANTITY_WORDS[language][quantity] ?? String(quantity);
}

function directCartReply(state: ConversationState): string {
  const { cart, currentLanguage: language } = state;
  if (cart.length === 0) {
    if (language === 'hi') return 'अभी आपका कार्ट खाली है।';
    if (language === 'gu') return 'હાલમાં તમારું કાર્ટ ખાલી છે.';
    return 'Your cart is currently empty.';
  }
  const lines = cart.map((line) => `${spokenQuantity(line.quantity, language)} ${line.productName}`);
  const total = cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0).toLocaleString('en-IN');
  if (language === 'hi') return `आपके कार्ट में ${lines.join(' और ')} हैं। अभी कुल ₹${total} है, जिसे फॉर्म पर दोबारा चेक किया जाएगा।`;
  if (language === 'gu') return `તમારા કાર્ટમાં ${lines.join(' અને ')} છે. હાલનું કુલ ₹${total} છે, જે ફોર્મ પર ફરી ચકાસવામાં આવશે.`;
  return `Your cart has ${lines.join(' and ')}. The provisional total is ₹${total}, which will be checked again on the form.`;
}

const CHECKOUT_FIELDS: (keyof ConversationState['checkoutFields'])[] = [
  'name', 'email', 'phone', 'address', 'city', 'state', 'postalCode', 'country',
];

function nextCheckoutQuestion(state: ConversationState): string | null {
  const field = CHECKOUT_FIELDS.find((key) => !state.checkoutFields[key]);
  if (!field) return null;
  const language = state.currentLanguage;
  const questions: Record<string, Record<ConversationState['currentLanguage'], string>> = {
    name: { en: 'What is your full name?', hi: 'आपका पूरा नाम क्या है?', gu: 'તમારું પૂરું નામ શું છે?' },
    email: { en: 'What is your email address?', hi: 'आपका ईमेल एड्रेस क्या है?', gu: 'તમારું ઈમેલ એડ્રેસ શું છે?' },
    phone: { en: 'What WhatsApp number should I use?', hi: 'आपका WhatsApp नंबर क्या है?', gu: 'તમારો WhatsApp નંબર શું છે?' },
    address: { en: 'What is your street address?', hi: 'आपका पूरा स्ट्रीट एड्रेस क्या है?', gu: 'તમારું પૂરું સ્ટ્રીટ એડ્રેસ શું છે?' },
    city: { en: 'Please tell me your city and state.', hi: 'अपना शहर और राज्य साथ में बताइए।', gu: 'તમારું શહેર અને રાજ્ય સાથે જણાવો.' },
    state: { en: 'Which state is the delivery address in?', hi: 'डिलीवरी एड्रेस किस राज्य में है?', gu: 'ડિલિવરી એડ્રેસ કયા રાજ્યમાં છે?' },
    postalCode: { en: 'What is your six-digit PIN code?', hi: 'आपका छह अंकों का पिन कोड क्या है?', gu: 'તમારો છ અંકનો પિન કોડ શું છે?' },
    country: { en: 'Is the delivery address in India?', hi: 'क्या डिलीवरी एड्रेस भारत में है?', gu: 'શું ડિલિવરી એડ્રેસ ભારતમાં છે?' },
  };
  return questions[field]?.[language] ?? null;
}

function ensureCheckoutProgressQuestion(
  reply: string,
  state: ConversationState,
): string {
  const workflowAdvanced = state.currentTurnFacts.some((fact) => [
    'add_cart_item', 'add_cart_items', 'update_cart_item',
    'set_checkout_field', 'set_delivery_location',
  ].includes(fact.toolName));
  if (!workflowAdvanced || state.cart.length === 0 || /\?/u.test(reply)) return reply;
  const question = nextCheckoutQuestion(state);
  if (!question) return reply;
  // Voice output is mechanically limited to two sentences. Keep one useful
  // confirmation sentence plus the required next question, otherwise a
  // two-sentence model preamble can push the checkout question past the cap.
  const firstSentence = (reply.trim().match(/^[^.!?।]+[.!?।]?/u)?.[0] ?? reply).trim();
  return `${firstSentence} ${question}`;
}

function formatWhatsAppReply(text: string): string {
  // WhatsApp bold uses one asterisk on each side. Some models still emit
  // GitHub-style double asterisks despite the channel prompt.
  return text.replace(/\*\*([^*\n]+)\*\*/g, '*$1*').trim();
}

function looksLikeSingleProductRecordDump(text: string): boolean {
  return /(?:^|\n)\s*(?:#{1,6}\s+|[-•]\s+)|(?:^|\n)\s*\*?(?:description|benefits?|dosage|suggested use|ingredients?|highlights?|warnings?)\*?\s*:/imu.test(text);
}

const MAX_TOOL_LOOP_ITERATIONS = 6;
// guard.py-style two-strike system: 1 regenerate attempt, then fallback.
const MAX_POLICY_REGENERATE_ATTEMPTS = 1;

export function shouldPrefetchProductCatalog(text: string): boolean {
  return /\b(products?|available|availability|stock|sell|selling|catalog(?:ue)?|details?|info(?:rmation)?|tell me about|benefits?|uses?|dosage|dose|ingredients?|directions?|warnings?)\b|प्रोडक्ट|उत्पाद|अवेलेबल|उपलब्ध|स्टॉक|जानकारी|फायदे|लाभ|खुराक|सामग्री|इस्तेमाल|चेतावनी|પ્રોડક્ટ|ઉપલબ્ધ|સ્ટોક|માહિતી|ફાયદા|લાભ|માત્રા|ઘટકો|ઉપયોગ|ચેતવણી/iu.test(text);
}

export function shouldAnswerCatalogDirectly(text: string): boolean {
  if (!shouldPrefetchProductCatalog(text)) return false;
  // Specific price, benefit, usage, and purchase questions still require
  // the normal tool/LLM loop. A plain "what do you sell?" does not: the live
  // list_products result is already the complete, grounded answer.
  return !/\b(price|cost|how much|details?|info(?:rmation)?|tell me about|benefits?|uses?|dosage|dose|ingredients?|directions?|warnings?|buy|order|add|want|need)\b|जानकारी|कीमत|दाम|फायदे|लाभ|खुराक|सामग्री|इस्तेमाल|खरीद|ऑर्डर|જાણકારી|કિંમત|ફાયદા|ઉપયોગ|ખરીદ|ઓર્ડર/iu.test(text);
}

interface LiveCatalogProduct {
  id: string;
  name: string;
  price?: number;
  currency?: string;
  stockLabel?: string;
}

const PRODUCT_NUMBER_PROMPTS: Record<ConversationState['currentLanguage'], string> = {
  en: 'Reply with the product number.',
  hi: 'प्रोडक्ट चुनने के लिए उसका नंबर भेजें।',
  gu: '\u0AAA\u0ACD\u0AB0\u0ACB\u0AA1\u0A95\u0ACD\u0A9F \u0AAA\u0AB8\u0A82\u0AA6 \u0A95\u0AB0\u0AB5\u0ABE \u0AA4\u0AC7\u0AA8\u0ACB \u0AA8\u0A82\u0AAC\u0AB0 \u0AAE\u0ACB\u0A95\u0AB2\u0ACB.',
};

function lastAssistantReply(messages: ConversationMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === 'assistant') return messages[index].content;
  }
  return null;
}

function isProductMenuSelection(userText: string, messages: ConversationMessage[]): boolean {
  return userText.trim() === '1' && (lastAssistantReply(messages)?.includes(WHATSAPP_MENU) ?? false);
}

function numberedProductSelectionNumber(userText: string, messages: ConversationMessage[]): number | null {
  const selection = userText.trim();
  if (!/^\d+$/.test(selection)) return null;
  const previousReply = lastAssistantReply(messages);
  if (!previousReply || !Object.values(PRODUCT_NUMBER_PROMPTS).some((prompt) => previousReply.includes(prompt))) {
    return null;
  }
  return Number.parseInt(selection, 10);
}

function liveCatalogProducts(catalog: unknown): LiveCatalogProduct[] {
  if (!catalog || typeof catalog !== 'object') return [];
  const products = (catalog as { products?: unknown }).products;
  if (!Array.isArray(products)) return [];
  return products.filter((product): product is LiveCatalogProduct =>
    Boolean(product && typeof product === 'object' &&
      typeof (product as LiveCatalogProduct).id === 'string' &&
      typeof (product as LiveCatalogProduct).name === 'string')
  );
}

function isProductInformationFollowUp(text: string): boolean {
  return /\b(product|details?|info(?:rmation)?|tell me|what (?:do|does|is)|benefits?|uses?|dosage|dose|ingredients?|directions?|warnings?|price|cost|stock|buy|order|it|that|yes|yeah|sure)\b|प्रोडक्ट|जानकारी|फायदे|खुराक|सामग्री|कीमत|दाम|हाँ|હા|પ્રોડક્ટ|માહિતી|ફાયદા|માત્રા|ઘટકો|કિંમત/iu.test(text);
}

function resolveProductForTurn(
  products: LiveCatalogProduct[],
  userText: string,
  messages: ConversationMessage[],
): LiveCatalogProduct | null {
  const currentMatch = products.find((product) => spokenProductNameMatches(product.name, userText));
  if (currentMatch) return currentMatch;
  if (!isProductInformationFollowUp(userText)) return null;

  // Resolve terse follow-ups ("yes", "tell me more") from the most recent
  // product the customer themselves named. Never rely on an old tool result.
  const priorUserMessages = messages
    .filter((message) => message.role === 'user' && message.content !== userText)
    .slice(-12)
    .reverse();
  for (const message of priorUserMessages) {
    const match = products.find((product) => spokenProductNameMatches(product.name, message.content));
    if (match) return match;
  }

  // A generic singular-product question is unambiguous when the live store
  // has exactly one active item.
  return products.length === 1 ? products[0] : null;
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

  if (names.length === 1) {
    const name = names[0];
    if (language === 'hi') return `अभी हमारे पास ${name} है। क्या आप इसके बारे में जानना चाहते हैं या इसे ऑर्डर करना चाहते हैं?`;
    if (language === 'gu') return `હાલમાં અમારી પાસે ${name} છે. તમે તેના વિશે જાણવા માંગો છો કે તેને ઓર્ડર કરવા માંગો છો?`;
    return `We currently offer ${name}. Would you like to hear about it or order it?`;
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

function resolveNumberedProductSelection(
  products: LiveCatalogProduct[],
  selectionNumber: number,
  messages: ConversationMessage[],
): LiveCatalogProduct | null {
  const previousReply = lastAssistantReply(messages);
  if (!previousReply || selectionNumber < 1) return null;
  const prefix = `${selectionNumber}. `;
  const displayedLine = previousReply.split(/\r?\n/).find((line) => line.startsWith(prefix));
  if (!displayedLine) return null;
  return products.find((product) =>
    displayedLine === `${prefix}${product.name}` || displayedLine.startsWith(`${prefix}${product.name} — `)
  ) ?? null;
}

function buildNumberedCatalogReply(
  catalog: unknown,
  language: ConversationState['currentLanguage'],
  invalidSelection = false,
): string {
  if (!catalog || typeof catalog !== 'object' || 'error' in catalog) {
    if (language === 'hi') return 'माफ़ कीजिए, अभी प्रोडक्ट लोड नहीं हो पाए। कृपया फिर कोशिश करें।';
    if (language === 'gu') return '\u0AAE\u0ABE\u0AAB \u0A95\u0AB0\u0AB6\u0ACB, \u0AB9\u0ABE\u0AB2 \u0AAA\u0ACD\u0AB0\u0ACB\u0AA1\u0A95\u0ACD\u0A9F\u0ACD\u0AB8 \u0AB2\u0ACB\u0AA1 \u0AA5\u0A88 \u0AB6\u0A95\u0AC0 \u0AA8\u0AA5\u0AC0. \u0A95\u0AC3\u0AAA\u0ABE \u0A95\u0AB0\u0AC0\u0AA8\u0AC7 \u0AAB\u0AB0\u0AC0 \u0AAA\u0ACD\u0AB0\u0AAF\u0ABE\u0AB8 \u0A95\u0AB0\u0ACB.';
    return 'Sorry, I could not load the products right now. Please try again.';
  }

  const products = liveCatalogProducts(catalog);
  if (products.length === 0) {
    if (language === 'hi') return `अभी कोई प्रोडक्ट उपलब्ध नहीं है।\n\n${WHATSAPP_MENU}`;
    if (language === 'gu') return `\u0AB9\u0ABE\u0AB2 \u0A95\u0ACB\u0A88 \u0AAA\u0ACD\u0AB0\u0ACB\u0AA1\u0A95\u0ACD\u0A9F \u0A89\u0AAA\u0AB2\u0AAC\u0ACD\u0AA7 \u0AA8\u0AA5\u0AC0.\n\n${WHATSAPP_MENU}`;
    return `No products are available right now.\n\n${WHATSAPP_MENU}`;
  }

  const lines = products.map((product, index) => {
    const parts = [`${index + 1}. ${product.name}`];
    if (typeof product.price === 'number' && Number.isFinite(product.price)) {
      parts.push(`${product.currency === 'INR' || !product.currency ? '₹' : `${product.currency} `}${product.price}`);
    }
    if (typeof product.stockLabel === 'string' && product.stockLabel.trim()) parts.push(product.stockLabel.trim());
    return parts.join(' — ');
  });
  const invalid = invalidSelection
    ? language === 'hi'
      ? 'यह मान्य प्रोडक्ट नंबर नहीं है।\n\n'
      : language === 'gu'
        ? '\u0A86 \u0AAE\u0ABE\u0AA8\u0ACD\u0AAF \u0AAA\u0ACD\u0AB0\u0ACB\u0AA1\u0A95\u0ACD\u0A9F \u0AA8\u0A82\u0AAC\u0AB0 \u0AA8\u0AA5\u0AC0.\n\n'
        : 'That is not a valid product number.\n\n'
    : '';
  return `${invalid}${lines.join('\n')}\n\n${PRODUCT_NUMBER_PROMPTS[language]}`;
}

export interface TurnOutcome {
  state: ConversationState;
  replyText: string;
  policyViolations: string[];
  productImage?: { url: string; caption: string };
  outboundActions?: OutboundAction[];
  /** Voice transport closes only after this reply has fully played. */
  callShouldEnd?: boolean;
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
  const outboundActions: OutboundAction[] = [];
  const toolContext: ToolContext = { callSessionId, state, channel, outboundActions };
  let productImage: TurnOutcome['productImage'];
  const productMenuSelected = channel === 'text' && isProductMenuSelection(userText, state.messages);
  const selectedProductNumber = channel === 'text'
    ? numberedProductSelectionNumber(userText, state.messages)
    : null;
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

  if (channel === 'voice' && state.awaitingReviewReceiptConfirmation && confirmedReviewReceipt(userText)) {
    state.awaitingReviewReceiptConfirmation = false;
    const replyText = reviewReceivedPrompt(state.currentLanguage);
    state.messages.push({ role: 'assistant', content: replyText });
    return { state, replyText, policyViolations: [], outboundActions, callShouldEnd: true };
  }

  if (CART_SUMMARY_PATTERN.test(userText)) {
    const cartTool = toolsByName.get_cart;
    const cartResult = cartTool
      ? await cartTool.handler({}, toolContext)
      : { items: state.cart };
    state.currentTurnFacts.push({ toolName: 'get_cart', resultJson: JSON.stringify(cartResult) });
    const replyText = directCartReply(state);
    state.messages.push({ role: 'assistant', content: replyText });
    return { state, replyText, policyViolations: [], outboundActions };
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
  turnContextMessages.push({
    role: 'system',
    content:
      `DURABLE ORDER STATE (authoritative, persisted outside chat history): cart=${JSON.stringify(state.cart)}, ` +
      `checkoutFields=${JSON.stringify(state.checkoutFields)}, ` +
      `awaitingReviewReceiptConfirmation=${state.awaitingReviewReceiptConfirmation === true}. ` +
      'Never describe a non-empty cart as empty. ' +
      'Use get_cart for any cart question and use the checkout tools for changes.',
  });
  const preloadedToolResults = new Map<string, unknown>();
  // WhatsApp is asynchronous and customers commonly answer with only a
  // product name or "yes". Fetching the small live catalog on every text turn
  // makes current website/admin data deterministic instead of optional model
  // behaviour. Voice does the same before checkout and for explicit product
  // questions, while avoiding an unnecessary lookup for each delivery field.
  // Before checkout starts, fetch the small live catalog on every turn. This
  // lets a brand-name-only question ("Morilife+ ke fayde?") resolve without
  // depending on the model to decide that it should call list_products.
  if (channel === 'text' || !checkoutStarted || shouldPrefetchProductCatalog(userText)) {
    const listTool = toolsByName.list_products;
    if (listTool) {
      let productCatalog: unknown;
      try {
        productCatalog = await listTool.handler({ query: null }, toolContext);
      } catch (err) {
        productCatalog = { error: 'tool_execution_failed', message: (err as Error).message };
      }
      const resultJson = JSON.stringify(productCatalog);
      state.currentTurnFacts.push({ toolName: 'list_products', resultJson });
      preloadedToolResults.set('list_products:{"query":null}', productCatalog);

      if (productMenuSelected) {
        const finalText = buildNumberedCatalogReply(productCatalog, state.currentLanguage);
        state.messages.push({ role: 'assistant', content: finalText });
        return { state, replyText: finalText, policyViolations: [], outboundActions };
      }

      const currentProducts = liveCatalogProducts(productCatalog);
      const numberedProduct = selectedProductNumber !== null
        ? resolveNumberedProductSelection(currentProducts, selectedProductNumber, state.messages)
        : null;
      if (selectedProductNumber !== null && !numberedProduct) {
        const finalText = buildNumberedCatalogReply(productCatalog, state.currentLanguage, true);
        state.messages.push({ role: 'assistant', content: finalText });
        return { state, replyText: finalText, policyViolations: [], outboundActions };
      }

      if (shouldAnswerCatalogDirectly(userText)) {
        const directReply = buildDirectCatalogReply(productCatalog, state.currentLanguage);
        if (directReply) {
          const finalText = channel === 'voice'
            ? limitSpokenReply(normalizeIndicSpeechText(toSpokenText(directReply), state.currentLanguage))
            : directReply;
          state.messages.push({ role: 'assistant', content: finalText });
          return { state, replyText: finalText, policyViolations: [], outboundActions };
        }
      }

      turnContextMessages.push({
        role: 'system',
        content:
          `LIVE PRODUCT CATALOG FOR THIS TURN (already fetched with list_products): ${resultJson}. ` +
          'Use it directly for catalog, availability, and product-name resolution. For benefits, dosage, ' +
          'ingredients, directions, or warnings, still call get_product_knowledge with the matching product ID.',
      });

      const selectedProduct = channel === 'text' && selectedProductNumber !== null
        ? numberedProduct
        : resolveProductForTurn(currentProducts, userText, state.messages);
      // Product details and every admin-approved knowledge category are also
      // deterministic for voice. Previously this prefetch happened only in
      // WhatsApp, leaving phone answers dependent on optional model tool use.
      if (selectedProduct) {
        const detailsTool = toolsByName.get_product_details;
        if (detailsTool) {
          const [details, knowledge] = await Promise.all([
            detailsTool.handler({ productId: selectedProduct.id }, toolContext)
              .catch((err) => ({ error: 'tool_execution_failed', message: (err as Error).message })),
            getAllApprovedProductKnowledge(selectedProduct.id)
              .catch((err) => ({ error: 'tool_execution_failed', message: (err as Error).message })),
          ]);
          const detailsJson = JSON.stringify(details);
          const knowledgeJson = JSON.stringify(knowledge);
          state.currentTurnFacts.push({ toolName: 'get_product_details', resultJson: detailsJson });
          state.currentTurnFacts.push({ toolName: 'get_product_knowledge', resultJson: knowledgeJson });
          if (details && typeof details === 'object') {
            const liveDetails = details as { found?: boolean; imageUrl?: unknown; name?: unknown };
            if (liveDetails.found && typeof liveDetails.imageUrl === 'string' && /^https:\/\//i.test(liveDetails.imageUrl)) {
              productImage = {
                url: liveDetails.imageUrl,
                caption: typeof liveDetails.name === 'string' ? liveDetails.name : selectedProduct.name,
              };
            }
          }
          turnContextMessages.push({
            role: 'system',
            content:
              `LIVE WEBSITE DETAILS FOR THE SELECTED PRODUCT (freshly fetched this turn): ${detailsJson}. ` +
              `LIVE ADMIN-APPROVED KNOWLEDGE FOR THE SAME PRODUCT (freshly fetched this turn): ${knowledgeJson}. ` +
              (selectedProductNumber !== null
                ? `The customer's numeric reply selected product option ${selectedProductNumber}, ${selectedProduct.name}. Ask how many units they want; do not interpret this number as a quantity. `
                : '') +
              'Answer the customer directly from these current records. Use only the categories relevant to their question. ' +
              'Treat the records as factual notes: synthesize them into polished, natural customer-facing sentences instead of ' +
              'copying field labels or knowledge entries. Never replace these records with remembered or general product claims.',
          });
        }
      }
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
  let productStyleRegenerateAttempts = 0;
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
              resultObj = await toolModule.handler(parsedArgs, toolContext);
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
          delivery = await toolsByName.create_verification_link.handler({}, toolContext);
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
          const reviewUrl = channel === 'text'
            ? outboundActions.find((action) => action.type === 'checkout_review')?.url
            : undefined;
          const replyText = reviewFormReply(delivery.ok === true, state.currentLanguage, reviewUrl);
          if (delivery.ok && channel === 'voice') state.awaitingReviewReceiptConfirmation = true;
          state.messages.push({ role: 'assistant', content: replyText });
          return { state, replyText, policyViolations: [], productImage, outboundActions };
        }
      }

      continue; // let the model see the tool results and respond
    }

    // Final assistant message candidate for this turn.
    if (channel === 'text' && productImage && looksLikeSingleProductRecordDump(result.content) && productStyleRegenerateAttempts < 1) {
      productStyleRegenerateAttempts++;
      transientCorrection = {
        role: 'system',
        content:
          '[Formatting correction] Rewrite the answer as exactly one or two short, connected, customer-friendly paragraphs. ' +
          'Do not use headings, bullets, field labels, or a knowledge-base-style dump. Keep every factual and safety claim grounded ' +
          'in the live records already supplied for this turn.',
      };
      continue;
    }

    const replyCandidate = ensureCheckoutProgressQuestion(result.content, state);
    const policyResult = enforceOutputPolicy(replyCandidate, state.currentTurnFacts, callSessionId, state.currentLanguage);

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
      ? limitSpokenReply(normalizeIndicSpeechText(toSpokenText(policyResult.text), state.currentLanguage))
      : formatWhatsAppReply(policyResult.text);
    state.messages.push({ role: 'assistant', content: finalText });
    return { state, replyText: finalText, policyViolations: policyResult.violations, productImage, outboundActions };
  }

  const fallback = turnFailurePrompt(state.currentLanguage);
  state.messages.push({ role: 'assistant', content: fallback });
  return { state, replyText: fallback, policyViolations: ['tool_loop_guard_exceeded'], productImage, outboundActions };
}
