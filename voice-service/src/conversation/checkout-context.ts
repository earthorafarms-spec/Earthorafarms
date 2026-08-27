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
  if (!nextMissing) return null;

  const locationRule = nextMissing === 'city' || nextMissing === 'state'
    ? ' If the reply contains both city and state, call set_delivery_location and save both in this turn.'
    : '';

  return (
    `CHECKOUT FIELD EXPECTED NOW: ${nextMissing}. Unless the caller clearly changes the topic, treat their ` +
    `latest reply as the value for ${nextMissing} and save it immediately with the checkout tool.` +
    locationRule +
    ' Accept a clearly spoken place name in English, Hindi, Gujarati, or Romanized form. Do not ask the caller ' +
    'to translate it into English, and do not ask them to repeat a value that is already clear.'
  );
}
