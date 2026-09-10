import type { ConversationState, ConversationMessage, CartSnapshotLine, CheckoutFieldSnapshot } from './state.js';
import { SYSTEM_PROMPT } from './prompt.js';
import {
  WHATSAPP_MENU,
  WHATSAPP_POLICIES_MENU,
  WHATSAPP_SHIPPING_POLICY,
  WHATSAPP_RETURN_POLICY,
  WHATSAPP_SYSTEM_PROMPT,
} from '../../../whatsapp-chatbot/prompt.js';
import { enforceOutputPolicy } from './output-policy.js';
import { limitSpokenReply, normalizeIndicSpeechText, toSpokenText } from './speech-format.js';
import { detectLanguage, requestedLanguage, buildLanguageInstruction } from './language.js';
import { reviewReceivedPrompt, turnFailurePrompt } from './voice-copy.js';
import { buildCheckoutTurnInstruction } from './checkout-context.js';
import { chatWithRouting } from '../providers.js';
import { allTools, toolsByName } from '../tools/index.js';
import { isCheckoutReady, normalizeSpokenDigitSequence, normalizeWhatsAppPhone } from '../tools/checkout.js';
import { spokenProductNameMatches } from '../tools/products.js';
import { getAllApprovedProductKnowledge } from '../tools/knowledge.js';
import type { OutboundAction, ToolContext } from '../tools/types.js';
import {
  parseProductActionInput,
  parseProductActionFromText,
  parseCartActionInput,
  type WhatsAppProductCard,
  type WhatsAppButton,
  type WhatsAppCartAction,
} from '../../../whatsapp-chatbot/product-card.js';

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

const CART_PRICING_PATTERN =
  /\b(?:total(?:\s+(?:amount|price|cost))?|amount|subtotal|bill\s+total|cart\s+(?:price|cost))\b|टोटल|अमाउंट|कुल(?:\s+(?:कीमत|प्राइस|दाम))?|કુલ|રકમ/iu;

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
  const money = (value: number) => value.toLocaleString('en-IN');
  const lines = cart.map((line) => {
    const quantity = spokenQuantity(line.quantity, language);
    if (language === 'hi') return `${quantity} ${line.productName}, ₹${money(line.unitPrice)} (Tax Included) प्रति पैक`;
    if (language === 'gu') return `${quantity} ${line.productName}, પેક દીઠ ₹${money(line.unitPrice)} (Tax Included)`;
    return `${quantity} ${line.productName} at ₹${money(line.unitPrice)} (Tax Included) each`;
  });
  const total = cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0).toLocaleString('en-IN');
  if (language === 'hi') return `आपके कार्ट में ${lines.join(' और ')} हैं। सही कुल ₹${total} (Tax Included) है।`;
  if (language === 'gu') return `તમારા કાર્ટમાં ${lines.join(' અને ')} છે. સાચું કુલ ₹${total} (Tax Included) છે.`;
  return `Your cart has ${lines.join(' and ')}. The exact total is ₹${total} (Tax Included).`;
}

function cartMutationReply(state: ConversationState): string {
  const summary = directCartReply(state);
  if (state.cart.length === 0) return summary;
  const nextQuestion = nextCheckoutQuestion(state);
  if (!nextQuestion) return summary;
  // Keep the exact backend-calculated total and the next checkout question
  // inside the two-sentence voice limit. The LLM never verbalizes cart math.
  const compactSummary = state.currentLanguage === 'hi'
    ? summary.replace(' हैं। सही कुल', ' हैं, और सही कुल')
    : state.currentLanguage === 'gu'
      ? summary.replace(' છે. સાચું કુલ', ' છે, અને સાચું કુલ')
      : summary.replace('. The exact total', ', and the exact total');
  return `${compactSummary} ${nextQuestion}`;
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

function looksLikeEmailAddress(text: string): boolean {
  const value = text.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) ||
    /\b\w+\s+(?:at|ऐट|एट|એટ)\s+\w+\s+(?:dot|डॉट|ડોટ)\s+\w+\b/iu.test(value);
}

function savedEmailThenPhonePrompt(language: ConversationState['currentLanguage']): string {
  if (language === 'hi') return 'आपका ईमेल एड्रेस पहले ही सेव हो चुका है। अब अपना दस अंकों का WhatsApp नंबर एक-एक अंक बोलकर बताइए।';
  if (language === 'gu') return 'તમારું ઈમેલ એડ્રેસ પહેલેથી સેવ થઈ ગયું છે. હવે તમારો દસ અંકનો WhatsApp નંબર એક પછી એક બોલો.';
  return 'I already saved your email address. Now please say your ten-digit WhatsApp number one digit at a time.';
}

function openingClarification(language: ConversationState['currentLanguage']): string {
  if (language === 'hi') return 'नमस्ते! मैं प्रोडक्ट की जानकारी या ऑर्डर में मदद कर सकती हूँ। आप क्या जानना चाहते हैं?';
  if (language === 'gu') return 'નમસ્તે! હું પ્રોડક્ટની માહિતી અથવા ઓર્ડરમાં મદદ કરી શકું છું. તમે શું જાણવા માંગો છો?';
  return 'Hello! I can help with product information or an order. What would you like to know?';
}

function hasExplicitOpeningIntent(text: string): boolean {
  return shouldPrefetchProductCatalog(text) ||
    /\b(?:buy|order|add|cart|want|need|quantity|bottles?|packs?|price|cost)\b|खरीद|ऑर्डर|कार्ट|चाहिए|बोतल|पैक|कीमत|ઓર્ડર|કાર્ટ|જોઈએ|બોટલ|પેક|કિંમત/iu.test(text);
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
  return /\b(products?|available|availability|stock|sell|selling|catalog(?:ue)?|details?|info(?:rmation)?|tell me about|benefits?|uses?|dosage|dose|ingredients?|directions?|warnings?|pregnan(?:t|cy)|breastfeed(?:ing)?)\b|प्रोडक्ट|उत्पाद|अवेलेबल|उपलब्ध|स्टॉक|जानकारी|फायदे|लाभ|खुराक|सामग्री|इस्तेमाल|चेतावनी|गर्भवती|गर्भावस्था|स्तनपान|प्रेग्नेंट|પ્રોડક્ટ|ઉપલબ્ધ|સ્ટોક|માહિતી|ફાયદા|લાભ|માત્રા|ઘટકો|ઉપયોગ|ચેતવણી|ગર્ભવતી|ગર્ભાવસ્થા|સ્તનપાન|પ્રેગ્નન્ટ/iu.test(text);
}

const DIGIT_CONFIRM_YES = /\b(?:yes|yeah|yep|correct|right)\b|हाँ|हां|सही|હા|સાચું|બરાબર/iu;
const DIGIT_CONFIRM_NO = /\b(?:no|nope|wrong|incorrect)\b|नहीं|नही|गलत|ના|નહીં|ખોટું/iu;
const SPOKEN_DIGITS: Record<ConversationState['currentLanguage'], string[]> = {
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'],
  hi: ['शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ'],
  gu: ['શૂન્ય', 'એક', 'બે', 'ત્રણ', 'ચાર', 'પાંચ', 'છ', 'સાત', 'આઠ', 'નવ'],
};

function speakDigits(value: string, language: ConversationState['currentLanguage']): string {
  return value.replace(/^\+91/, '').replace(/\D/g, '').split('')
    .map((digit) => SPOKEN_DIGITS[language][Number(digit)]).join(', ');
}

function digitConfirmationPrompt(
  field: 'phone' | 'postalCode',
  value: string,
  language: ConversationState['currentLanguage'],
): string {
  const digits = speakDigits(value, language);
  if (language === 'hi') return `मैंने ${field === 'phone' ? 'WhatsApp नंबर' : 'पिन कोड'} ${digits} सुना है। क्या यह सही है?`;
  if (language === 'gu') return `મેં તમારો ${field === 'phone' ? 'WhatsApp નંબર' : 'પિન કોડ'} ${digits} સાંભળ્યો છે. શું આ સાચું છે?`;
  return `I heard your ${field === 'phone' ? 'WhatsApp number' : 'PIN code'} as ${digits}. Is that correct?`;
}

function invalidDigitPrompt(field: 'phone' | 'postalCode', language: ConversationState['currentLanguage']): string {
  const length = field === 'phone' ? 10 : 6;
  if (language === 'hi') return `यह ${field === 'phone' ? 'फोन नंबर' : 'पिन कोड'} पूरा नहीं है। कृपया सभी ${length === 10 ? 'दस' : 'छह'} अंक एक-एक करके दोबारा बोलें।`;
  if (language === 'gu') return `આ ${field === 'phone' ? 'ફોન નંબર' : 'પિન કોડ'} પૂરું નથી. કૃપા કરીને બધા ${length === 10 ? 'દસ' : 'છ'} અંક એક પછી એક ફરી બોલો.`;
  return `That ${field === 'phone' ? 'phone number' : 'PIN code'} is incomplete. Please repeat all ${length === 10 ? 'ten' : 'six'} digits one at a time.`;
}

function confirmationRequiredPrompt(language: ConversationState['currentLanguage']): string {
  if (language === 'hi') return 'कृपया हाँ या नहीं में बताइए कि अंक सही हैं।';
  if (language === 'gu') return 'અંક સાચા છે કે નહીં તે હા અથવા ના કહીને જણાવો.';
  return 'Please say yes or no to confirm whether those digits are correct.';
}

function savedDigitReply(state: ConversationState): string {
  const next = nextCheckoutQuestion(state);
  if (state.currentLanguage === 'hi') return `धन्यवाद, अंक सेव हो गए हैं। ${next ?? ''}`.trim();
  if (state.currentLanguage === 'gu') return `આભાર, અંક સેવ થઈ ગયા છે. ${next ?? ''}`.trim();
  return `Thank you, I saved those digits. ${next ?? ''}`.trim();
}

export function shouldAnswerCatalogDirectly(text: string): boolean {
  if (!shouldPrefetchProductCatalog(text)) return false;
  // Specific price, benefit, usage, and purchase questions still require
  // the normal tool/LLM loop. A plain "what do you sell?" does not: the live
  // list_products result is already the complete, grounded answer.
  return !/\b(price|cost|how much|details?|info(?:rmation)?|tell me about|benefits?|uses?|dosage|dose|ingredients?|directions?|warnings?|pregnan(?:t|cy)|breastfeed(?:ing)?|buy|order|add|want|need)\b|जानकारी|कीमत|दाम|फायदे|लाभ|खुराक|सामग्री|इस्तेमाल|गर्भवती|गर्भावस्था|स्तनपान|प्रेग्नेंट|खरीद|ऑर्डर|જાણકારી|કિંમત|ફાયદા|ઉપયોગ|ગર્ભવતી|ગર્ભાવસ્થા|સ્તનપાન|પ્રેગ્નન્ટ|ખરીદ|ઓર્ડર/iu.test(text);
}

interface LiveCatalogProduct {
  id: string;
  name: string;
  price?: number;
  currency?: string;
  stockLabel?: string;
}

const MATERNAL_SAFETY_PATTERN =
  /\b(?:pregnan(?:t|cy)|breastfeed(?:ing)?|nursing mother)\b|गर्भवती|गर्भावस्था|स्तनपान|प्रेग्नेंट|પ્રેગ્નન્ટ|ગર્ભવતી|ગર્ભાવસ્થા|સ્તનપાન/iu;

function maternalSafetyReply(
  knowledge: unknown,
  productName: string,
  language: ConversationState['currentLanguage'],
): string {
  const entries = knowledge && typeof knowledge === 'object' && Array.isArray((knowledge as { entries?: unknown }).entries)
    ? (knowledge as { entries: { category?: unknown; content?: unknown }[] }).entries
    : [];
  const approvedWarning = entries.find((entry) =>
    entry?.category === 'warnings' && typeof entry.content === 'string' && MATERNAL_SAFETY_PATTERN.test(entry.content));

  if (!approvedWarning) {
    if (language === 'hi') return `${productName} के लिए गर्भावस्था या स्तनपान से जुड़ी कन्फर्म जानकारी अभी उपलब्ध नहीं है। इसे लेने से पहले अपने डॉक्टर से सलाह लें।`;
    if (language === 'gu') return `${productName} માટે ગર્ભાવસ્થા અથવા સ્તનપાન વિશે કન્ફર્મ માહિતી ઉપલબ્ધ નથી. તેને લેતા પહેલાં તમારા ડૉક્ટરની સલાહ લો.`;
    return `I do not have approved pregnancy or breastfeeding guidance for ${productName}. Please consult your doctor before taking it.`;
  }

  if (language === 'hi') {
    return `गर्भावस्था या स्तनपान के दौरान ${productName} लेने से पहले डॉक्टर से सलाह लें। अगर कोई स्वास्थ्य समस्या है या नियमित दवाइयाँ चल रही हैं, तो भी डॉक्टर से पूछें।`;
  }
  if (language === 'gu') {
    return `ગર્ભાવસ્થા અથવા સ્તનપાન દરમિયાન ${productName} લેતા પહેલાં ડૉક્ટરની સલાહ લો. કોઈ સ્વાસ્થ્ય સમસ્યા હોય અથવા નિયમિત દવા લેતા હો, તો પણ ડૉક્ટરને પૂછો.`;
  }
  return `Please consult a doctor before taking ${productName} during pregnancy or breastfeeding. Also consult them if you have a health problem or take regular medicines.`;
}

export function buildProductKnowledgeReply(
  knowledge: unknown,
  product: LiveCatalogProduct,
  action: 'benefits' | 'dosage',
  language: ConversationState['currentLanguage'],
): string {
  const entries = knowledge && typeof knowledge === 'object' && Array.isArray((knowledge as { entries?: unknown }).entries)
    ? (knowledge as { entries: { category?: unknown; content?: unknown }[] }).entries
    : [];

  const entry = entries.find((e) =>
    e?.category === action && typeof e.content === 'string' && e.content.trim().length > 0
  ) ?? (action === 'dosage' ? entries.find((e) =>
    e?.category === 'directions' && typeof e.content === 'string' && e.content.trim().length > 0
  ) : undefined);

  if (!entry || typeof entry.content !== 'string' || !entry.content.trim()) {
    if (language === 'hi') {
      return `${product.name} के लिए ${action === 'benefits' ? 'फायदे' : 'खुराक'} की स्वीकृत जानकारी अभी उपलब्ध नहीं है।\n\nमेन्यू पर वापस जाने के लिए Menu लिखें।`;
    }
    if (language === 'gu') {
      return `${product.name} માટે ${action === 'benefits' ? 'ફાયદા' : 'માત્રા'} વિશેની માન્ય માહિતી હાલમાં ઉપલબ્ધ નથી.\n\nમેનુ પર પાછા જવા માટે Menu લખો.`;
    }
    return `Approved ${action === 'benefits' ? 'benefits' : 'dosage'} information is not available for ${product.name}.\n\nTo return to the main menu, type Menu.`;
  }

  const content = entry.content.trim();

  if (language === 'hi') {
    const heading = action === 'benefits' ? `*${product.name} के फायदे:*` : `*${product.name} की खुराक और उपयोग:*`;
    const actionsHint = 'कार्ट में जोड़ने के लिए "Add to Cart" लिखें।\nमेन्यू पर वापस जाने के लिए Menu लिखें।';
    return `${heading}\n${content}\n\n${actionsHint}`;
  }
  if (language === 'gu') {
    const heading = action === 'benefits' ? `*${product.name} ના ફાયદા:*` : `*${product.name} ની માત્રા અને ઉપયોગ:*`;
    const actionsHint = 'કાર્ટમાં ઉમેરવા માટે "Add to Cart" લખો.\nમેનુ પર પાછા જવા માટે Menu લખો.';
    return `${heading}\n${content}\n\n${actionsHint}`;
  }
  const heading = action === 'benefits' ? `*Benefits of ${product.name}:*` : `*Dosage & Directions for ${product.name}:*`;
  const actionsHint = 'To add to cart, type "Add to Cart".\nTo return to the main menu, type Menu.';
  return `${heading}\n${content}\n\n${actionsHint}`;
}

interface LiveProductDetails {
  found?: boolean;
  id?: string;
  name?: string;
  description?: string;
  highlights?: string[];
  price?: number;
  mrp?: number;
  currency?: string;
  stockLabel?: string;
  inStock?: boolean;
  imageUrl?: string;
}

const PRODUCT_NUMBER_PROMPTS: Record<ConversationState['currentLanguage'], string> = {
  en: 'Reply with the product number.',
  hi: 'प्रोडक्ट चुनने के लिए उसका नंबर भेजें।',
  gu: '\u0AAA\u0ACD\u0AB0\u0ACB\u0AA1\u0A95\u0ACD\u0A9F \u0AAA\u0AB8\u0A82\u0AA6 \u0A95\u0AB0\u0AB5\u0ABE \u0AA4\u0AC7\u0AA8\u0ACB \u0AA8\u0A82\u0AAC\u0AB0 \u0AAE\u0ACB\u0A95\u0AB2\u0ACB.',
};

const WHATSAPP_MENU_GREETINGS: Record<ConversationState['currentLanguage'], string> = {
  en: 'Hello! How can I assist you today? If you have any questions or need help with our products, feel free to ask!',
  hi: 'नमस्ते!',
  gu: 'નમસ્તે!',
};

function lastAssistantReply(messages: ConversationMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === 'assistant') return messages[index].content;
  }
  return null;
}

export const EXPLICIT_MENU_PATTERN =
  /^(?:0|menu|main\s+menu|back|वापस|पाछा|મેનુ|મુખ્ય\s+મેનુ|मेन्यू|मुख्य\s+मेन्यू)[\s!.?,🙏]*$/iu;

export function isExplicitMenuRequest(userText: string): boolean {
  const trimmed = userText.trim();
  if (parseCartActionInput(trimmed) === 'main_menu') return true;
  if (EXPLICIT_MENU_PATTERN.test(trimmed)) return true;
  return /\b(?:main\s+menu|menu|available\s+options?)\b|(?:मुख्य\s+)?मेन्यू|उपलब्ध\s+विकल्प|(?:મુખ્ય\s+)?મેનુ|ઉપલબ્ધ\s+વિકલ્પ/iu.test(trimmed);
}

export const COMMON_GREETING_PATTERN =
  /^(?:hi(?:i+)?|he(?:l+)?o(?:o+)?|hey(?:y+)?|hi\s+there|hello\s+there|hey\s+there|hey\s+bot|good\s+(?:morning|afternoon|evening|day)|namaste(?:\s+ji)?|namaskar(?:\s+ji)?|kem\s+ch(?:h)?o|kemcho|नमस्ते(?:\s+जी)?|नमस्कार|प्रणाम|નમસ્તે|નમસ્કાર|કેમ\s+છો)[\s!.?,🙏]*$/iu;

export function isCommonGreeting(userText: string): boolean {
  return COMMON_GREETING_PATTERN.test(userText.trim());
}

export function shouldShowWhatsAppMenu(userText: string, state: ConversationState): boolean {
  const previousReply = lastAssistantReply(state.messages);
  const awaitingQuantity = Boolean(
    state.whatsAppProductContext?.awaitingQuantity === true ||
    (previousReply && /\b(?:how many|quantity|units?)\b|कितन(?:ा|ी|े)|यूनिट|માત્રા|કેટલ(?:ા|ી)|યુનિટ/iu.test(previousReply))
  );
  const nextCheckoutPrompt = state.cart.length > 0 ? nextCheckoutQuestion(state) : null;
  const activeCheckoutCollection = Boolean(nextCheckoutPrompt && previousReply?.includes(nextCheckoutPrompt));

  if (activeCheckoutCollection || awaitingQuantity || state.awaitingCartRemoval) {
    return false;
  }

  const trimmed = userText.trim();
  if (parseCartActionInput(trimmed) === 'main_menu') return true;
  if (trimmed === '2' && state.cart.length === 0 && isViewCartReply(previousReply, state)) return true;
  if (isExplicitMenuRequest(userText)) return true;
  if (!isCommonGreeting(userText)) return false;

  return true;
}

function buildWhatsAppMenuReply(language: ConversationState['currentLanguage']): string {
  return `${WHATSAPP_MENU_GREETINGS[language]}\n\n${WHATSAPP_MENU}`;
}

function isProductMenuSelection(userText: string, messages: ConversationMessage[]): boolean {
  return userText.trim() === '1' && (lastAssistantReply(messages)?.includes(WHATSAPP_MENU) ?? false);
}

function isPoliciesMenuSelection(userText: string, messages: ConversationMessage[], state: ConversationState): boolean {
  if (state.whatsAppProductContext?.awaitingQuantity || state.awaitingCartRemoval) return false;
  const previousReply = lastAssistantReply(messages);
  if (!previousReply) return false;
  const nextCheckoutPrompt = state.cart.length > 0 ? nextCheckoutQuestion(state) : null;
  if (nextCheckoutPrompt && previousReply.includes(nextCheckoutPrompt)) return false;

  const trimmed = userText.trim();
  if (trimmed === '3' && previousReply.includes(WHATSAPP_MENU) && !previousReply.includes(WHATSAPP_POLICIES_MENU)) return true;
  if (/^(?:policies|policy|नीति|નીતિ)$/i.test(trimmed)) return true;
  return false;
}

function isShippingPolicySelection(userText: string, messages: ConversationMessage[], state: ConversationState): boolean {
  if (state.whatsAppProductContext?.awaitingQuantity || state.awaitingCartRemoval) return false;
  const previousReply = lastAssistantReply(messages);
  if (!previousReply) return false;
  const nextCheckoutPrompt = state.cart.length > 0 ? nextCheckoutQuestion(state) : null;
  if (nextCheckoutPrompt && previousReply.includes(nextCheckoutPrompt)) return false;

  const trimmed = userText.trim();
  if (trimmed === '1' && previousReply.includes(WHATSAPP_POLICIES_MENU)) return true;
  if (/^(?:shipping\s*policy|shipping\s*(&|and)?\s*delivery|delivery\s*policy)$/i.test(trimmed)) return true;
  return false;
}

function isReturnPolicySelection(userText: string, messages: ConversationMessage[], state: ConversationState): boolean {
  if (state.whatsAppProductContext?.awaitingQuantity || state.awaitingCartRemoval) return false;
  const previousReply = lastAssistantReply(messages);
  if (!previousReply) return false;
  const nextCheckoutPrompt = state.cart.length > 0 ? nextCheckoutQuestion(state) : null;
  if (nextCheckoutPrompt && previousReply.includes(nextCheckoutPrompt)) return false;

  const trimmed = userText.trim();
  if (trimmed === '2' && previousReply.includes(WHATSAPP_POLICIES_MENU)) return true;
  if (/^(?:returns?\s*(&|and)?\s*(order\s*)?cancellation(\s*policy)?|return\s*policy|cancellation\s*policy|refund\s*policy)$/i.test(trimmed)) return true;
  return false;
}

export function buildPostAddToCartCard(
  productName: string,
  language: ConversationState['currentLanguage'],
): WhatsAppProductCard {
  const confirmation = language === 'hi'
    ? `${productName} कार्ट में जोड़ दिया है।`
    : language === 'gu'
      ? `${productName} કાર્ટમાં ઉમેર્યું છે.`
      : `${productName} has been added to your cart.`;
  return {
    body: confirmation,
    buttons: [
      { id: 'earthora_cart:view_cart', title: 'View Cart' },
      { id: 'earthora_cart:checkout', title: 'Checkout' },
      { id: 'earthora_cart:continue_shopping', title: 'Continue Shopping' },
    ],
  };
}

export function buildViewCartCard(
  state: ConversationState,
): WhatsAppProductCard {
  const body = directCartReply(state);
  const buttons: WhatsAppButton[] = state.cart.length > 0
    ? [
        { id: 'earthora_cart:remove_item', title: 'Remove Item' },
        { id: 'earthora_cart:checkout', title: 'Checkout' },
        { id: 'earthora_cart:continue_shopping', title: 'Continue Shopping' },
      ]
    : [
        { id: 'earthora_cart:continue_shopping', title: 'Continue Shopping' },
        { id: 'earthora_cart:main_menu', title: 'Main Menu' },
      ];
  return {
    body,
    buttons,
  };
}

export function buildCartRemovalPromptReply(
  cart: CartSnapshotLine[],
  language: ConversationState['currentLanguage'],
  invalidSelection = false,
): string {
  if (cart.length === 0) {
    if (language === 'hi') return 'अभी आपका कार्ट खाली है।';
    if (language === 'gu') return 'હાલમાં તમારું કાર્ટ ખાલી છે.';
    return 'Your cart is currently empty.';
  }

  const prefix = invalidSelection
    ? language === 'hi'
      ? 'यह मान्य आइटम नंबर नहीं है।\n\n'
      : language === 'gu'
        ? 'આ માન્ય આઇટમ નંબર નથી.\n\n'
        : 'That is not a valid item number.\n\n'
    : '';

  const heading = language === 'hi'
    ? 'हटाने के लिए आइटम चुनें:'
    : language === 'gu'
      ? 'દૂર કરવા માટે આઇટમ પસંદ કરો:'
      : 'Select an item to remove:';

  const lines = cart.map((item, index) => {
    const total = (item.quantity * item.unitPrice).toLocaleString('en-IN');
    const unit = item.unitPrice.toLocaleString('en-IN');
    const qtyLabel = `${item.quantity} ${item.quantity === 1 ? 'unit' : 'units'}`;
    if (language === 'hi') {
      return `${index + 1}. ${item.productName} (${item.quantity} यूनिट) — ₹${unit} (Tax Included) प्रति पैक — कुल ₹${total} (Tax Included)`;
    }
    if (language === 'gu') {
      return `${index + 1}. ${item.productName} (${item.quantity} યુનિટ) — પેક દીઠ ₹${unit} (Tax Included) — કુલ ₹${total} (Tax Included)`;
    }
    return `${index + 1}. ${item.productName} (${qtyLabel}) — ₹${unit} (Tax Included) each — Total ₹${total} (Tax Included)`;
  });

  const prompt = language === 'hi'
    ? 'हटाने के लिए आइटम का नंबर भेजें।\nरद्द करने के लिए Cancel लिखें।'
    : language === 'gu'
      ? 'દૂર કરવા માટે આઇટમ નંબર મોકલો.\nરદ કરવા માટે Cancel લખો.'
      : 'Reply with the item number to remove.\nTo cancel, type Cancel.';

  return `${prefix}${heading}\n${lines.join('\n')}\n\n${prompt}`;
}

function isPostAddToCartReply(text: string | null): boolean {
  if (!text) return false;
  return text.includes('has been added to your cart') ||
    text.includes('कार्ट में जोड़ दिया है') ||
    text.includes('કાર્ટમાં ઉમેર્યું છે');
}

function isViewCartReply(text: string | null, state?: ConversationState): boolean {
  if (!text) return false;
  if (state && state.cart.length > 0) {
    const nextQuestion = nextCheckoutQuestion(state);
    if (nextQuestion && text.includes(nextQuestion)) return false;
  }
  if (/\b(?:What is your|आपका पूरा नाम|તમારું પૂરું નામ|What WhatsApp number|six-digit PIN|street address)\b/iu.test(text)) {
    return false;
  }
  return text.includes('Your cart has') || text.includes('Your cart is currently empty') ||
    text.includes('आपके कार्ट में') || text.includes('अभी आपका कार्ट खाली है') ||
    text.includes('તમારા કાર્ટમાં') || text.includes('હાલમાં તમારું કાર્ટ ખાલી છે');
}

function isViewCartSelection(userText: string, previousReply: string | null, state?: ConversationState): boolean {
  const nextPrompt = state && state.cart.length > 0 ? nextCheckoutQuestion(state) : null;
  if (nextPrompt && previousReply?.includes(nextPrompt)) return false;

  const trimmed = userText.trim();
  if (parseCartActionInput(trimmed) === 'view_cart') return true;
  if (/^(?:view\s*cart|my\s*cart|show\s*cart|cart|कॉर्ट|કાર્ટ|કાર્ટ\s*જુઓ|कार्ट|कार्ट\s*देखें)$/iu.test(trimmed)) return true;
  if (trimmed === '1' && isPostAddToCartReply(previousReply)) return true;
  return false;
}

function isRemoveItemSelection(userText: string, previousReply: string | null, state?: ConversationState): boolean {
  const nextPrompt = state && state.cart.length > 0 ? nextCheckoutQuestion(state) : null;
  if (nextPrompt && previousReply?.includes(nextPrompt)) return false;

  const trimmed = userText.trim();
  if (parseCartActionInput(trimmed) === 'remove_item') return true;
  if (/^(?:remove\s*item|remove\s*product|remove|delete\s*item|delete|हटाएं|हटाओ|કાઢો|દૂર\s*કરો)$/iu.test(trimmed)) return true;
  if (trimmed === '1' && state && state.cart.length > 0 && isViewCartReply(previousReply, state)) return true;
  return false;
}

function isCheckoutSelection(userText: string, previousReply: string | null, state: ConversationState): boolean {
  const nextPrompt = state.cart.length > 0 ? nextCheckoutQuestion(state) : null;
  if (nextPrompt && previousReply?.includes(nextPrompt)) return false;

  const trimmed = userText.trim();
  if (parseCartActionInput(trimmed) === 'checkout') return true;
  if (/^(?:checkout|check\s*out|order\s*now|place\s*order|चेकआउट|ચેકઆઉટ)$/iu.test(trimmed)) return true;
  if (trimmed === '2' && isPostAddToCartReply(previousReply)) return true;
  if (trimmed === '2' && state.cart.length > 0 && isViewCartReply(previousReply, state)) return true;
  return false;
}

function isContinueShoppingSelection(userText: string, previousReply: string | null, state?: ConversationState): boolean {
  const nextPrompt = state && state.cart.length > 0 ? nextCheckoutQuestion(state) : null;
  if (nextPrompt && previousReply?.includes(nextPrompt)) return false;

  const trimmed = userText.trim();
  if (parseCartActionInput(trimmed) === 'continue_shopping') return true;
  if (/^(?:continue\s*shopping|shop\s*more|browse\s*products|browse|खरीदारी|વધુ\s*ખરીદી)$/iu.test(trimmed)) return true;
  if (trimmed === '3' && isPostAddToCartReply(previousReply)) return true;
  if (trimmed === '3' && state && state.cart.length > 0 && isViewCartReply(previousReply, state)) return true;
  if (trimmed === '1' && state && state.cart.length === 0 && isViewCartReply(previousReply, state)) return true;
  return false;
}

function numberedProductSelectionNumber(userText: string, messages: ConversationMessage[]): number | null {
  const selection = userText.trim();
  if (!/^[1-9]\d*$/.test(selection)) return null;
  const previousReply = lastAssistantReply(messages);
  if (!previousReply || !Object.values(PRODUCT_NUMBER_PROMPTS).some((prompt) => previousReply.includes(prompt))) {
    return null;
  }
  return Number.parseInt(selection, 10);
}

const CHECKOUT_QUESTION_MATCHERS: {
  field: keyof CheckoutFieldSnapshot | 'city_state';
  matches: (text: string) => boolean;
  isActive: (state: ConversationState) => boolean;
}[] = [
  {
    field: 'name',
    matches: (text) => /What is your full name\?|आपका पूरा नाम क्या है\?|તમારું પૂરું નામ શું છે\?/i.test(text),
    isActive: (state) => !state.checkoutFields.name,
  },
  {
    field: 'email',
    matches: (text) => /What is your email address\?|आपका ईमेल एड्रेस क्या है\?|તમારું ઈમેલ એડ્રેસ શું છે\?/i.test(text),
    isActive: (state) => Boolean(state.checkoutFields.name) && !state.checkoutFields.email,
  },
  {
    field: 'phone',
    matches: (text) => /What WhatsApp number should I use\?|आपका WhatsApp नंबर क्या है\?|તમારો WhatsApp નંબર શું છે\?/i.test(text),
    isActive: (state) => !state.checkoutFields.phone,
  },
  {
    field: 'address',
    matches: (text) => /What is your street address\?|आपका पूरा स्ट्रीट एड्रेस क्या है\?|તમારું પૂરું સ્ટ્રીટ એડ્રેસ શું છે\?/i.test(text),
    isActive: (state) => !state.checkoutFields.address,
  },
  {
    field: 'city_state',
    matches: (text) => /Please tell me your city and state\.|अपना शहर और राज्य साथ में बताइए।|તમારું શહેર અને રાજ્ય સાથે જણાવો\./i.test(text),
    isActive: (state) => !state.checkoutFields.city || !state.checkoutFields.state,
  },
  {
    field: 'state',
    matches: (text) => /Which state is the delivery address in\?|डिलीवरी एड्रेस किस राज्य में है\?|ડિલિવરી એડ્રેસ કયા રાજ્યમાં છે\?/i.test(text),
    isActive: (state) => Boolean(state.checkoutFields.city) && !state.checkoutFields.state,
  },
  {
    field: 'postalCode',
    matches: (text) => /What is your six-digit PIN code\?|आपका छह अंकों का पिन कोड क्या है\?|તમારો છ અંકનો પિન કોડ શું છે\?/i.test(text),
    isActive: (state) => !state.checkoutFields.postalCode,
  },
  {
    field: 'country',
    matches: (text) => /Is the delivery address in India\?|क्या डिलीवरी एड्रेस भारत में है\?|શું ડિલિવરી એડ્રેસ ભારતમાં છે\?/i.test(text),
    isActive: (state) => !state.checkoutFields.country,
  },
];

function getActiveCheckoutQuestionField(
  previousReply: string | null,
  state: ConversationState,
): keyof CheckoutFieldSnapshot | 'city_state' | null {
  if (!previousReply) return null;
  for (const entry of CHECKOUT_QUESTION_MATCHERS) {
    if (entry.isActive(state) && entry.matches(previousReply)) {
      return entry.field;
    }
  }
  return null;
}

function parseCityAndStateInput(input: string): { city: string; state?: string } {
  const parts = input.split(/[,\n]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { city: parts[0], state: parts.slice(1).join(', ') };
  }
  const words = input.trim().split(/\s+/);
  if (words.length >= 2) {
    const lastWord = words[words.length - 1];
    const twoWord = words.slice(-2).join(' ');
    const knownState = [
      'gujarat', 'maharashtra', 'rajasthan', 'madhya pradesh', 'delhi', 'punjab',
      'haryana', 'karnataka', 'tamil nadu', 'kerala', 'uttar pradesh', 'west bengal',
      'bihar', 'goa', 'assam', 'odisha', 'gujrat', 'gujrath', 'गुजरात', 'ગુજરાત',
      'महाराष्ट्र', 'મહારાષ્ટ્ર', 'राजस्थान', 'રાજસ્થાન',
    ].find((s) => s.toLowerCase() === twoWord.toLowerCase() || s.toLowerCase() === lastWord.toLowerCase());
    if (knownState) {
      const statePart = knownState.includes(' ') ? twoWord : lastWord;
      const cityPart = input.slice(0, input.toLowerCase().lastIndexOf(statePart.toLowerCase())).trim();
      if (cityPart) {
        return { city: cityPart, state: statePart };
      }
    }
  }
  return { city: input.trim() };
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
  return /\b(product|details?|info(?:rmation)?|tell me|what (?:do|does|is)|benefits?|uses?|dosage|dose|ingredients?|directions?|warnings?|pregnan(?:t|cy)|breastfeed(?:ing)?|price|cost|stock|buy|order|it|that|yes|yeah|sure)\b|प्रोडक्ट|जानकारी|फायदे|खुराक|सामग्री|कीमत|दाम|गर्भवती|गर्भावस्था|स्तनपान|प्रेग्नेंट|हाँ|હા|પ્રોડક્ટ|માહિતી|ફાયદા|માત્રા|ઘટકો|ગર્ભવતી|ગર્ભાવસ્થા|સ્તનપાન|પ્રેગ્નન્ટ|કિંમત/iu.test(text);
}

function resolveProductForTurn(
  products: LiveCatalogProduct[],
  userText: string,
  messages: ConversationMessage[],
  whatsAppProductContext?: ConversationState['whatsAppProductContext'],
): LiveCatalogProduct | null {
  const currentMatch = products.find((product) => spokenProductNameMatches(product.name, userText));
  if (currentMatch) return currentMatch;
  if (!isProductInformationFollowUp(userText)) return null;

  if (whatsAppProductContext?.productId) {
    const contextMatch = products.find((product) => product.id === whatsAppProductContext.productId);
    if (contextMatch) return contextMatch;
  }

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
      parts.push(`${product.currency === 'INR' || !product.currency ? '₹' : `${product.currency} `}${product.price} (Tax Included)`);
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
  return `${invalid}${lines.join('\n')}\n\n${PRODUCT_NUMBER_PROMPTS[language]}\nTo return to the main menu, type Menu.`;
}

function buildWhatsAppProductCard(details: LiveProductDetails, fallbackName: string): WhatsAppProductCard | null {
  if (!details.found || typeof details.id !== 'string') return null;

  const hasValidImage = typeof details.imageUrl === 'string' && /^https:\/\//i.test(details.imageUrl);
  const imageUrl = hasValidImage ? details.imageUrl : undefined;

  const name = typeof details.name === 'string' && details.name.trim() ? details.name.trim() : fallbackName;
  const price = typeof details.price === 'number' && Number.isFinite(details.price)
    ? `${details.currency === 'INR' || !details.currency ? '₹' : `${details.currency} `}${details.price.toLocaleString('en-IN')} (Tax Included)`
    : null;
  const mrp = price && typeof details.mrp === 'number' && Number.isFinite(details.mrp) && details.mrp > (details.price ?? 0)
    ? `MRP ₹${details.mrp.toLocaleString('en-IN')}`
    : null;
  const detailLine = [price, mrp, details.stockLabel].filter((value): value is string => Boolean(value)).join(' • ');
  const rawDescription = typeof details.description === 'string' && details.description.trim()
    ? details.description
    : Array.isArray(details.highlights) ? details.highlights[0] ?? '' : '';
  const compactDescription = rawDescription.replace(/\s+/g, ' ').trim();
  const shortDescription = compactDescription.length > 360
    ? `${compactDescription.slice(0, 357).trimEnd()}...`
    : compactDescription;
  const body = [`*${name}*`, detailLine, shortDescription, 'To return to the main menu, type Menu.'].filter(Boolean).join('\n');
  return {
    productId: details.id,
    name,
    body,
    ...(imageUrl ? { imageUrl } : {}),
  };
}

function productActionFailure(language: ConversationState['currentLanguage']): string {
  if (language === 'hi') return 'माफ़ कीजिए, यह प्रोडक्ट अभी उपलब्ध नहीं है। कृपया प्रोडक्ट मेन्यू फिर से खोलें।';
  if (language === 'gu') return 'માફ કરશો, આ પ્રોડક્ટ હાલમાં ઉપલબ્ધ નથી. કૃપા કરીને પ્રોડક્ટ મેનુ ફરી ખોલો.';
  return 'Sorry, this product is not currently available. Please open the product menu again.';
}

function productQuantityPrompt(productName: string, language: ConversationState['currentLanguage']): string {
  if (language === 'hi') return `आप ${productName} की कितनी यूनिट कार्ट में जोड़ना चाहते हैं?`;
  if (language === 'gu') return `તમે ${productName} ના કેટલા યુનિટ કાર્ટમાં ઉમેરવા માંગો છો?`;
  return `How many units of ${productName} would you like to add to your cart?`;
}

export interface TurnOutcome {
  state: ConversationState;
  replyText: string;
  policyViolations: string[];
  productImage?: { url: string; caption: string };
  productCard?: WhatsAppProductCard;
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
  let productCard: TurnOutcome['productCard'];
  const productAction = channel === 'text'
    ? (parseProductActionInput(userText) ?? parseProductActionFromText(userText, state.whatsAppProductContext?.productId))
    : null;
  const productMenuSelected = channel === 'text' && isProductMenuSelection(userText, state.messages);
  const selectedProductNumber = channel === 'text'
    ? numberedProductSelectionNumber(userText, state.messages)
    : null;
  state.turnCount += 1;
  // Cleared every turn — see conversation/state.ts TurnToolFact doc comment.
  // A fact from a previous turn is not a fact the model may rely on; it
  // must call the tool again this turn.
  state.currentTurnFacts = [];

  if (!productAction) {
    state.messages.push({ role: 'user', content: userText });
  }

  // Deterministic and per-turn. Confident full Hindi, Gujarati, or English
  // utterances switch the reply language even after the cart/checkout has
  // started. Short ambiguous values such as "yes", a PIN, or "Ahmedabad"
  // return null from detectLanguage and therefore keep the current language.
  const checkoutStarted = state.cart.length > 0 || Object.keys(state.checkoutFields).length > 0;
  const explicitLanguage = productAction ? null : requestedLanguage(userText);
  if (explicitLanguage) {
    state.currentLanguage = explicitLanguage;
  } else if (!productAction) {
    const detected = detectLanguage(userText);
    if (detected) state.currentLanguage = detected;
  }

  // A clipped/noisy opening transcript must never trigger an unprompted
  // catalog pitch. Let the caller state a product or order intent first.
  const userMessageCount = state.messages.filter((message) => message.role === 'user').length;
  if (channel === 'voice' && userMessageCount === 1 && !checkoutStarted && !hasExplicitOpeningIntent(userText)) {
    const replyText = openingClarification(state.currentLanguage);
    state.messages.push({ role: 'assistant', content: replyText });
    return { state, replyText, policyViolations: [], outboundActions };
  }

  if (channel === 'voice' && state.awaitingReviewReceiptConfirmation && confirmedReviewReceipt(userText)) {
    state.awaitingReviewReceiptConfirmation = false;
    const replyText = reviewReceivedPrompt(state.currentLanguage);
    state.messages.push({ role: 'assistant', content: replyText });
    return { state, replyText, policyViolations: [], outboundActions, callShouldEnd: true };
  }

  if (channel === 'voice' && state.pendingDigitConfirmation) {
    const pending = state.pendingDigitConfirmation;
    if (DIGIT_CONFIRM_NO.test(userText)) {
      delete state.pendingDigitConfirmation;
      const replyText = invalidDigitPrompt(pending.field, state.currentLanguage);
      state.messages.push({ role: 'assistant', content: replyText });
      return { state, replyText, policyViolations: [], outboundActions };
    }
    if (!DIGIT_CONFIRM_YES.test(userText)) {
      const replyText = confirmationRequiredPrompt(state.currentLanguage);
      state.messages.push({ role: 'assistant', content: replyText });
      return { state, replyText, policyViolations: [], outboundActions };
    }
    const toolResult = await toolsByName.set_checkout_field.handler(
      { field: pending.field, value: pending.value }, toolContext);
    state.currentTurnFacts.push({ toolName: 'set_checkout_field', resultJson: JSON.stringify(toolResult) });
    if ((toolResult as { ok?: boolean }).ok) delete state.pendingDigitConfirmation;
    const replyText = (toolResult as { ok?: boolean }).ok
      ? savedDigitReply(state)
      : invalidDigitPrompt(pending.field, state.currentLanguage);
    state.messages.push({ role: 'assistant', content: replyText });
    return { state, replyText, policyViolations: [], outboundActions };
  }

  if (channel === 'voice' && state.cart.length > 0) {
    const expectedField = CHECKOUT_FIELDS.find((key) => !state.checkoutFields[key]);
    if (expectedField === 'phone' || expectedField === 'postalCode') {
      // Do not reinterpret a repeated email as a failed phone/PIN sequence.
      // This can happen when the caller did not hear the acknowledgement and
      // repeats the email they just gave.
      if (expectedField === 'phone' && looksLikeEmailAddress(userText)) {
        const replyText = savedEmailThenPhonePrompt(state.currentLanguage);
        state.messages.push({ role: 'assistant', content: replyText });
        return { state, replyText, policyViolations: [], outboundActions };
      }
      const digits = normalizeSpokenDigitSequence(userText);
      if (digits) {
        const storedValue = expectedField === 'phone' ? normalizeWhatsAppPhone(digits) : digits;
        const valid = expectedField === 'phone' ? Boolean(storedValue) : /^\d{6}$/.test(digits);
        if (!valid || !storedValue) {
          const replyText = invalidDigitPrompt(expectedField, state.currentLanguage);
          state.messages.push({ role: 'assistant', content: replyText });
          return { state, replyText, policyViolations: [], outboundActions };
        }
        state.pendingDigitConfirmation = { field: expectedField, value: storedValue };
        const replyText = digitConfirmationPrompt(expectedField, storedValue, state.currentLanguage);
        state.messages.push({ role: 'assistant', content: replyText });
        return { state, replyText, policyViolations: [], outboundActions };
      }
    }
  }

  if (CART_SUMMARY_PATTERN.test(userText) || (state.cart.length > 0 && CART_PRICING_PATTERN.test(userText))) {
    delete state.awaitingCartRemoval;
    const cartTool = toolsByName.get_cart;
    const cartResult = cartTool
      ? await cartTool.handler({}, toolContext)
      : { items: state.cart };
    state.currentTurnFacts.push({ toolName: 'get_cart', resultJson: JSON.stringify(cartResult) });
    if (channel === 'text') {
      delete state.whatsAppProductContext;
      const cartCard = buildViewCartCard(state);
      state.messages.push({ role: 'assistant', content: cartCard.body });
      return { state, replyText: cartCard.body, productCard: cartCard, policyViolations: [], outboundActions };
    }
    const replyText = directCartReply(state);
    state.messages.push({ role: 'assistant', content: replyText });
    return { state, replyText, policyViolations: [], outboundActions };
  }

  const pendingProduct = channel === 'text' && state.whatsAppProductContext?.awaitingQuantity
    ? state.whatsAppProductContext
    : null;
  if (pendingProduct && /^\d+$/.test(userText.trim())) {
    const quantity = Number.parseInt(userText.trim(), 10);
    if (quantity < 1) {
      const replyText = productQuantityPrompt(pendingProduct.productName, state.currentLanguage);
      state.messages.push({ role: 'assistant', content: replyText });
      return { state, replyText, policyViolations: [], outboundActions };
    }
    const addResult = await toolsByName.add_cart_item.handler(
      { productId: pendingProduct.productId, quantity },
      toolContext,
    ).catch((err) => ({ ok: false, reason: (err as Error).message }));
    state.currentTurnFacts.push({ toolName: 'add_cart_item', resultJson: JSON.stringify(addResult) });
    const added = Boolean(addResult && typeof addResult === 'object' && (addResult as { ok?: boolean }).ok);
    if (!added) {
      const replyText = productActionFailure(state.currentLanguage);
      pendingProduct.awaitingQuantity = false;
      state.messages.push({ role: 'assistant', content: replyText });
      return { state, replyText, policyViolations: [], outboundActions };
    }
    pendingProduct.awaitingQuantity = false;
    delete state.awaitingCartRemoval;

    if (channel === 'text') {
      delete state.whatsAppProductContext;
      const postAddCard = buildPostAddToCartCard(pendingProduct.productName, state.currentLanguage);
      state.messages.push({ role: 'assistant', content: postAddCard.body });
      return {
        state,
        replyText: postAddCard.body,
        productCard: postAddCard,
        policyViolations: [],
        outboundActions,
      };
    }

    const nextQuestion = nextCheckoutQuestion(state);
    const confirmation = state.currentLanguage === 'hi'
      ? `${pendingProduct.productName} कार्ट में जोड़ दिया है।`
      : state.currentLanguage === 'gu'
        ? `${pendingProduct.productName} કાર્ટમાં ઉમેર્યું છે.`
        : `${pendingProduct.productName} has been added to your cart.`;
    const replyText = nextQuestion ? `${confirmation} ${nextQuestion}` : confirmation;
    state.messages.push({ role: 'assistant', content: replyText });
    return { state, replyText, policyViolations: [], outboundActions };
  }

  if (channel === 'text' && state.awaitingCartRemoval) {
    const trimmed = userText.trim();
    if (
      parseCartActionInput(trimmed) === 'main_menu' ||
      /^(?:0|menu|main\s*menu|मेन्यू|મેનુ)$/iu.test(trimmed)
    ) {
      delete state.awaitingCartRemoval;
      delete state.whatsAppProductContext;
      const replyText = buildWhatsAppMenuReply(state.currentLanguage);
      state.messages.push({ role: 'assistant', content: replyText });
      return { state, replyText, policyViolations: [], outboundActions };
    }

    if (
      parseCartActionInput(trimmed) === 'view_cart' ||
      /^(?:cancel|stop|back|cart|view\s*cart|रद्द|वापस|પાછા|રદ)$/iu.test(trimmed)
    ) {
      delete state.awaitingCartRemoval;
      delete state.whatsAppProductContext;
      const cartCard = buildViewCartCard(state);
      state.messages.push({ role: 'assistant', content: cartCard.body });
      return { state, replyText: cartCard.body, productCard: cartCard, policyViolations: [], outboundActions };
    }

    if (isCheckoutSelection(userText, lastAssistantReply(state.messages), state)) {
      delete state.awaitingCartRemoval;
    } else if (isContinueShoppingSelection(userText, lastAssistantReply(state.messages), state)) {
      delete state.awaitingCartRemoval;
    } else {
      delete state.whatsAppProductContext;
      if (state.cart.length === 0) {
        delete state.awaitingCartRemoval;
        const cartCard = buildViewCartCard(state);
        state.messages.push({ role: 'assistant', content: cartCard.body });
        return { state, replyText: cartCard.body, productCard: cartCard, policyViolations: [], outboundActions };
      }

      let selectedIndex = -1;
      const numMatch = trimmed.match(/^(?:item\s*#?|#)?(\d+)$/i);
      if (numMatch) {
        const idx = Number.parseInt(numMatch[1], 10) - 1;
        if (idx >= 0 && idx < state.cart.length) {
          selectedIndex = idx;
        }
      }
      if (selectedIndex === -1) {
        const matchIdx = state.cart.findIndex((item) => {
          const itemLower = item.productName.toLowerCase();
          const textLower = trimmed.toLowerCase();
          return textLower.length >= 3 && (itemLower.includes(textLower) || textLower.includes(itemLower));
        });
        if (matchIdx >= 0) {
          selectedIndex = matchIdx;
        }
      }

      if (selectedIndex >= 0 && selectedIndex < state.cart.length) {
        const removedItem = state.cart[selectedIndex];
        state.cart.splice(selectedIndex, 1);
        delete state.awaitingCartRemoval;
        state.currentTurnFacts.push({
          toolName: 'remove_cart_item',
          resultJson: JSON.stringify({ ok: true, removed: removedItem, remainingCount: state.cart.length }),
        });
        const removedNotice = state.currentLanguage === 'hi'
          ? `${removedItem.productName} कार्ट से हटा दिया गया है।`
          : state.currentLanguage === 'gu'
            ? `${removedItem.productName} કાર્ટમાંથી દૂર કરવામાં આવ્યું છે.`
            : `${removedItem.productName} has been removed from your cart.`;
        const cartCard = buildViewCartCard(state);
        const body = `${removedNotice}\n\n${cartCard.body}`;
        const responseCard = { ...cartCard, body };
        state.messages.push({ role: 'assistant', content: body });
        return {
          state,
          replyText: body,
          productCard: responseCard,
          policyViolations: [],
          outboundActions,
        };
      }

      const replyText = buildCartRemovalPromptReply(state.cart, state.currentLanguage, true);
      state.messages.push({ role: 'assistant', content: replyText });
      return { state, replyText, policyViolations: [], outboundActions };
    }
  }

  if (channel === 'text' && shouldShowWhatsAppMenu(userText, state)) {
    delete state.whatsAppProductContext;
    delete state.awaitingCartRemoval;
    const replyText = buildWhatsAppMenuReply(state.currentLanguage);
    state.messages.push({ role: 'assistant', content: replyText });
    return { state, replyText, policyViolations: [], outboundActions };
  }

  if (channel === 'text' && isViewCartSelection(userText, lastAssistantReply(state.messages), state)) {
    delete state.whatsAppProductContext;
    delete state.awaitingCartRemoval;
    const cartTool = toolsByName.get_cart;
    const cartResult = cartTool
      ? await cartTool.handler({}, toolContext)
      : { items: state.cart };
    state.currentTurnFacts.push({ toolName: 'get_cart', resultJson: JSON.stringify(cartResult) });
    const cartCard = buildViewCartCard(state);
    state.messages.push({ role: 'assistant', content: cartCard.body });
    return { state, replyText: cartCard.body, productCard: cartCard, policyViolations: [], outboundActions };
  }

  if (channel === 'text' && isRemoveItemSelection(userText, lastAssistantReply(state.messages), state)) {
    delete state.whatsAppProductContext;
    if (state.cart.length === 0) {
      delete state.awaitingCartRemoval;
      const cartCard = buildViewCartCard(state);
      state.messages.push({ role: 'assistant', content: cartCard.body });
      return { state, replyText: cartCard.body, productCard: cartCard, policyViolations: [], outboundActions };
    }
    state.awaitingCartRemoval = true;
    const replyText = buildCartRemovalPromptReply(state.cart, state.currentLanguage, false);
    state.messages.push({ role: 'assistant', content: replyText });
    return { state, replyText, policyViolations: [], outboundActions };
  }

  if (channel === 'text' && isCheckoutSelection(userText, lastAssistantReply(state.messages), state)) {
    delete state.whatsAppProductContext;
    delete state.awaitingCartRemoval;
    if (state.cart.length === 0) {
      const replyText = state.currentLanguage === 'hi'
        ? 'अभी आपका कार्ट खाली है।'
        : state.currentLanguage === 'gu'
          ? 'હાલમાં તમારું કાર્ટ ખાલી છે.'
          : 'Your cart is currently empty.';
      state.messages.push({ role: 'assistant', content: replyText });
      return { state, replyText, policyViolations: [], outboundActions };
    }
    const senderPhone = state.checkoutFields.phone;
    state.checkoutFields = { ...(senderPhone ? { phone: senderPhone } : {}) };
    delete state.activeCheckoutReview;
    const nextQuestion = nextCheckoutQuestion(state);
    if (nextQuestion) {
      state.messages.push({ role: 'assistant', content: nextQuestion });
      return { state, replyText: nextQuestion, policyViolations: [], outboundActions };
    }
  }

  if (channel === 'text' && isContinueShoppingSelection(userText, lastAssistantReply(state.messages), state)) {
    delete state.whatsAppProductContext;
    delete state.awaitingCartRemoval;
    const listTool = toolsByName.list_products;
    let productCatalog: unknown;
    try {
      productCatalog = listTool ? await listTool.handler({ query: null }, toolContext) : null;
    } catch (err) {
      productCatalog = { error: 'tool_execution_failed', message: (err as Error).message };
    }
    const resultJson = JSON.stringify(productCatalog);
    state.currentTurnFacts.push({ toolName: 'list_products', resultJson });
    const replyText = buildNumberedCatalogReply(productCatalog, state.currentLanguage);
    state.messages.push({ role: 'assistant', content: replyText });
    return { state, replyText, policyViolations: [], outboundActions };
  }

  if (channel === 'text' && isPoliciesMenuSelection(userText, state.messages, state)) {
    delete state.whatsAppProductContext;
    delete state.awaitingCartRemoval;
    const replyText = WHATSAPP_POLICIES_MENU;
    state.messages.push({ role: 'assistant', content: replyText });
    return { state, replyText, policyViolations: [], outboundActions };
  }

  if (channel === 'text' && isShippingPolicySelection(userText, state.messages, state)) {
    delete state.whatsAppProductContext;
    delete state.awaitingCartRemoval;
    const replyText = WHATSAPP_SHIPPING_POLICY;
    state.messages.push({ role: 'assistant', content: replyText });
    return { state, replyText, policyViolations: [], outboundActions };
  }

  if (channel === 'text' && isReturnPolicySelection(userText, state.messages, state)) {
    delete state.whatsAppProductContext;
    delete state.awaitingCartRemoval;
    const replyText = WHATSAPP_RETURN_POLICY;
    state.messages.push({ role: 'assistant', content: replyText });
    return { state, replyText, policyViolations: [], outboundActions };
  }

  const previousReplyForCheckout = lastAssistantReply(state.messages);
  const activeCheckoutField = channel === 'text' && state.cart.length > 0
    ? getActiveCheckoutQuestionField(previousReplyForCheckout, state)
    : null;

  if (activeCheckoutField !== null) {
    const trimmed = userText.trim();

    if (
      parseCartActionInput(trimmed) === 'main_menu' ||
      /^(?:0|menu|main\s*menu|मेन्यू|મેનુ)$/iu.test(trimmed)
    ) {
      delete state.whatsAppProductContext;
      delete state.awaitingCartRemoval;
      const replyText = buildWhatsAppMenuReply(state.currentLanguage);
      state.messages.push({ role: 'assistant', content: replyText });
      return { state, replyText, policyViolations: [], outboundActions };
    }

    if (
      parseCartActionInput(trimmed) === 'view_cart' ||
      /^(?:cancel|stop|back|cart|view\s*cart|रद्द|वापस|પાછા|રદ)$/iu.test(trimmed)
    ) {
      delete state.whatsAppProductContext;
      delete state.awaitingCartRemoval;
      const cartCard = buildViewCartCard(state);
      state.messages.push({ role: 'assistant', content: cartCard.body });
      return { state, replyText: cartCard.body, productCard: cartCard, policyViolations: [], outboundActions };
    }

    if (/^(?:checkout|check\s*out|चेकआउट|ચેકઆઉટ)$/iu.test(trimmed)) {
      const currentQuestion = nextCheckoutQuestion(state);
      if (currentQuestion) {
        state.messages.push({ role: 'assistant', content: currentQuestion });
        return { state, replyText: currentQuestion, policyViolations: [], outboundActions };
      }
    }

    // Greetings and bare digits on name question fall down to model
    // routing so policies/menu/chat guards remain covered.
    const isGreeting = isCommonGreeting(trimmed);
    const isDigitOnName = activeCheckoutField === 'name' && /^\d+$/.test(trimmed);

    if (!isGreeting && !isDigitOnName) {
      delete state.whatsAppProductContext;
      delete state.awaitingCartRemoval;

      let toolResult: unknown = null;

      if (activeCheckoutField === 'name') {
        toolResult = await toolsByName.set_checkout_field.handler(
          { field: 'name', value: trimmed },
          toolContext
        );
      } else if (activeCheckoutField === 'email') {
        toolResult = await toolsByName.set_checkout_field.handler(
          { field: 'email', value: trimmed },
          toolContext
        );
      } else if (activeCheckoutField === 'phone') {
        toolResult = await toolsByName.set_checkout_field.handler(
          { field: 'phone', value: trimmed },
          toolContext
        );
      } else if (activeCheckoutField === 'address') {
        toolResult = await toolsByName.set_checkout_field.handler(
          { field: 'address', value: trimmed },
          toolContext
        );
      } else if (activeCheckoutField === 'city_state') {
        const parsed = parseCityAndStateInput(trimmed);
        if (parsed.state) {
          toolResult = await toolsByName.set_delivery_location.handler(
            { city: parsed.city, state: parsed.state },
            toolContext
          );
        } else {
          toolResult = await toolsByName.set_checkout_field.handler(
            { field: 'city', value: parsed.city },
            toolContext
          );
        }
      } else if (activeCheckoutField === 'state') {
        toolResult = await toolsByName.set_checkout_field.handler(
          { field: 'state', value: trimmed },
          toolContext
        );
      } else if (activeCheckoutField === 'postalCode') {
        toolResult = await toolsByName.set_checkout_field.handler(
          { field: 'postalCode', value: trimmed },
          toolContext
        );
      } else if (activeCheckoutField === 'country') {
        const isIndia = /^(?:yes|yeah|हाँ|हां|હા|india|in india|भारत|ભારત)[.!?]*$/iu.test(trimmed);
        toolResult = await toolsByName.set_checkout_field.handler(
          { field: 'country', value: isIndia ? 'India' : trimmed },
          toolContext
        );
      }

      if (toolResult && typeof toolResult === 'object') {
        const toolOk = Boolean((toolResult as { ok?: boolean }).ok);
        state.currentTurnFacts.push({
          toolName: activeCheckoutField === 'city_state' && (toolResult as { city?: string; state?: string }).state
            ? 'set_delivery_location'
            : 'set_checkout_field',
          resultJson: JSON.stringify(toolResult),
        });

        if (toolOk) {
          const nextQuestion = nextCheckoutQuestion(state);
          if (nextQuestion) {
            state.messages.push({ role: 'assistant', content: nextQuestion });
            return { state, replyText: nextQuestion, policyViolations: [], outboundActions };
          }
        } else {
          const errMsg = (toolResult as { message?: string }).message;
          const currentQuestion = nextCheckoutQuestion(state);
          const replyText = [errMsg, currentQuestion].filter(Boolean).join(' ');
          state.messages.push({ role: 'assistant', content: replyText });
          return { state, replyText, policyViolations: [], outboundActions };
        }
      }
    }
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
  let actionProduct: LiveCatalogProduct | null = null;
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
      actionProduct = productAction
        ? currentProducts.find((product) => product.id === productAction.productId) ?? null
        : null;
      if (productAction && !actionProduct) {
        const replyText = productActionFailure(state.currentLanguage);
        state.messages.push({ role: 'assistant', content: replyText });
        return { state, replyText, policyViolations: [], outboundActions };
      }
      if (productAction?.action === 'add_to_cart' && actionProduct) {
        state.whatsAppProductContext = {
          productId: actionProduct.id,
          productName: actionProduct.name,
          awaitingQuantity: actionProduct.stockLabel !== 'Out of Stock',
          lastAction: 'add_to_cart',
        };
        const replyText = actionProduct.stockLabel === 'Out of Stock'
          ? productActionFailure(state.currentLanguage)
          : productQuantityPrompt(actionProduct.name, state.currentLanguage);
        state.messages.push({ role: 'assistant', content: replyText });
        return { state, replyText, policyViolations: [], outboundActions };
      }
      const numberedProduct = selectedProductNumber !== null
        ? resolveNumberedProductSelection(currentProducts, selectedProductNumber, state.messages)
        : null;
      if (selectedProductNumber !== null && !numberedProduct) {
        const finalText = buildNumberedCatalogReply(productCatalog, state.currentLanguage, true);
        state.messages.push({ role: 'assistant', content: finalText });
        return { state, replyText: finalText, policyViolations: [], outboundActions };
      }

      if (!productAction && shouldAnswerCatalogDirectly(userText)) {
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

      const selectedProduct = actionProduct ?? (channel === 'text' && selectedProductNumber !== null
        ? numberedProduct
        : resolveProductForTurn(currentProducts, userText, state.messages, state.whatsAppProductContext));
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
          if (!productAction && MATERNAL_SAFETY_PATTERN.test(userText)) {
            const groundedReply = maternalSafetyReply(knowledge, selectedProduct.name, state.currentLanguage);
            const finalText = channel === 'voice'
              ? limitSpokenReply(normalizeIndicSpeechText(toSpokenText(groundedReply), state.currentLanguage))
              : groundedReply;
            state.messages.push({ role: 'assistant', content: finalText });
            return { state, replyText: finalText, policyViolations: [], productImage, outboundActions };
          }
          if (details && typeof details === 'object') {
            const liveDetails = details as LiveProductDetails;
            if (!productAction && liveDetails.found) {
              if (typeof liveDetails.imageUrl === 'string' && /^https:\/\//i.test(liveDetails.imageUrl)) {
                productImage = {
                  url: liveDetails.imageUrl,
                  caption: typeof liveDetails.name === 'string' ? liveDetails.name : selectedProduct.name,
                };
              }
              if (channel === 'text') {
                productCard = buildWhatsAppProductCard(liveDetails, selectedProduct.name) ?? undefined;
                if (productCard) {
                  state.whatsAppProductContext = {
                    productId: productCard.productId ?? selectedProduct.id,
                    productName: productCard.name ?? selectedProduct.name,
                    awaitingQuantity: false,
                  };
                }
              }
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
          if (productAction && actionProduct) {
            state.whatsAppProductContext = {
              productId: actionProduct.id,
              productName: actionProduct.name,
              awaitingQuantity: false,
              lastAction: productAction.action,
            };

            if (channel === 'text' && (productAction.action === 'benefits' || productAction.action === 'dosage')) {
              const replyText = buildProductKnowledgeReply(
                knowledge,
                actionProduct,
                productAction.action,
                state.currentLanguage,
              );
              state.messages.push({ role: 'assistant', content: replyText });
              return {
                state,
                replyText,
                policyViolations: [],
                outboundActions,
              };
            }

            turnContextMessages.push({
              role: 'system',
              content:
                `The customer deterministically selected the ${productAction.action} button for ${actionProduct.name}. ` +
                `Answer only their ${productAction.action === 'benefits' ? 'benefits' : 'dosage and usage'} request from the ` +
                `live approved knowledge above. If approved ${productAction.action} knowledge is not available or empty for ${actionProduct.name}, ` +
                `state clearly that approved ${productAction.action} information is not available for ${actionProduct.name}; never assume, invent, or generalize claims.`,
            });
          }
          if (selectedProductNumber !== null && productCard) {
            state.messages.push({ role: 'assistant', content: productCard.body });
            return {
              state,
              replyText: productCard.body,
              policyViolations: [],
              productImage,
              productCard,
              outboundActions,
            };
          }
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
    const turnMessages: ConversationMessage[] = [
      systemMessage,
      ...turnContextMessages,
      ...state.messages,
      ...(channel !== 'text' && productAction && actionProduct ? [{
        role: 'user' as const,
        content: productAction.action === 'benefits'
          ? `What are the benefits of ${actionProduct.name}?`
          : `What is the dosage and directions for ${actionProduct.name}?`,
      }] : []),
      ...(transientCorrection ? [transientCorrection] : []),
    ];
    const result = await chatWithRouting(
      turnMessages,
      toolDefs,
      state.currentLanguage
    );

    if (result.kind === 'tool_calls') {
      const iterationResults: { name: string; value: unknown }[] = [];
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
        iterationResults.push({ name: call.name, value: resultObj });
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
          return { state, replyText, policyViolations: [], productImage, productCard, outboundActions };
        }
      }

      const successfulCartMutation = iterationResults.some(({ name, value }) =>
        ['add_cart_item', 'add_cart_items', 'update_cart_item', 'remove_cart_item'].includes(name) &&
        Boolean(value && typeof value === 'object' && (value as { ok?: boolean }).ok)
      );
      if (successfulCartMutation) {
        const exactReply = cartMutationReply(state);
        const replyText = channel === 'voice'
          ? limitSpokenReply(normalizeIndicSpeechText(toSpokenText(exactReply), state.currentLanguage))
          : formatWhatsAppReply(exactReply);
        state.messages.push({ role: 'assistant', content: replyText });
        return { state, replyText, policyViolations: [], productImage, outboundActions };
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
    return { state, replyText: finalText, policyViolations: policyResult.violations, productImage, productCard, outboundActions };
  }

  const fallback = turnFailurePrompt(state.currentLanguage);
  state.messages.push({ role: 'assistant', content: fallback });
  return { state, replyText: fallback, policyViolations: ['tool_loop_guard_exceeded'], productImage, productCard, outboundActions };
}
