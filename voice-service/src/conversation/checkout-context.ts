import type { CheckoutFieldSnapshot, ConversationState } from './state.js';

const REQUIRED_CHECKOUT_FIELDS: (keyof CheckoutFieldSnapshot)[] = [
  'name', 'email', 'phone', 'address', 'city', 'state', 'postalCode', 'country',
];

/**
 * Gives the model an explicit state-machine hint while checkout is active.
 * Short answers such as a city or state otherwise look like context-free
 * fragments and some models ask for them repeatedly instead of saving them.
 */
export function buildCheckoutTurnInstruction(state: ConversationState): string | null {
  if (state.cart.length === 0) return null;

  const nextMissing = REQUIRED_CHECKOUT_FIELDS.find((field) => !state.checkoutFields[field]);
  if (!nextMissing) {
    if (state.checkoutFields.gst === undefined) {
      return (
        'OPTIONAL GST QUESTION REQUIRED NOW: Ask whether the caller has a GST number for a business tax invoice. ' +
        'If they provide one, save it with set_checkout_field using field gst. If they say no, do not have one, ' +
        'or want to skip it, save an empty string in field gst so the decision is recorded. Do not create the ' +
        'verification link until this question has been answered.'
      );
    }
    return 'CHECKOUT READY NOW: Call create_verification_link in this turn to send the editable review form on WhatsApp. ' +
      'Do not ask for the details again, do not create a payment link, and do not claim it was sent until the tool succeeds. ' +
      'If delivery fails, explain that the form was not sent and keep the call open for help or a caller-requested retry.';
  }

  const locationRule = nextMissing === 'city' || nextMissing === 'state'
    ? ' If the reply contains both city and state, call set_delivery_location and save both in this turn.'
    : '';
  const countryRule = nextMissing === 'country'
    ? ' For an Indian delivery address, save the default country India now; ask only if the address is international or ambiguous.'
    : '';

  return (
    `CHECKOUT FIELD EXPECTED NOW: ${nextMissing}. Unless the caller clearly changes the topic, treat their ` +
    `latest reply as the value for ${nextMissing} and save it immediately with the checkout tool.` +
    locationRule +
    countryRule +
    ' Use the preceding assistant question to interpret short replies: yes/no confirms or rejects a pending value, ' +
    'not a new name/address. Never save yes, no, okay, or hello as a checkout field. ' +
    'Only save information not already consumed by a successful tool call in this turn. After saving it, ask for ' +
    'the next missing detail; never reinterpret the same answer as the next field. ' +
    ' Accept a clearly spoken place name in English, Hindi, Gujarati, or Romanized form. Do not ask the caller ' +
    'to translate it into English, and do not ask them to repeat a value that is already clear.'
  );
}

export type VoiceInputExpectation = 'phone' | 'postalCode' | 'quantity' | undefined;

/** Adds speech-recognition context without making numeric input mandatory. */
export function getVoiceInputExpectation(state: ConversationState): VoiceInputExpectation {
  if (state.pendingDigitConfirmation) return undefined;
  if (state.cart.length > 0) {
    const nextMissing = REQUIRED_CHECKOUT_FIELDS.find((field) => !state.checkoutFields[field]);
    if (nextMissing === 'phone' || nextMissing === 'postalCode') return nextMissing;
  }

  const lastAssistant = [...state.messages].reverse().find((message) => message.role === 'assistant')?.content ?? '';
  if (/\b(?:how many|quantity|units?|bottles?|packs?)\b|कितन(?:ा|ी|े)|यूनिट|बॉटल|પ(?:ેક|ૅક)|કેટલ(?:ા|ી)|યુનિટ|બોટલ/iu.test(lastAssistant)) {
    return 'quantity';
  }
  return undefined;
}
