export type WhatsAppProductAction = 'benefits' | 'dosage' | 'add_to_cart';
export type WhatsAppCartAction = 'view_cart' | 'checkout' | 'continue_shopping' | 'main_menu';

export interface WhatsAppButton {
  id: string;
  title: string;
}

export interface WhatsAppProductCard {
  productId?: string;
  imageUrl?: string;
  name?: string;
  body: string;
  buttons?: WhatsAppButton[];
}

const BUTTON_ID_PREFIX = 'earthora_product';
const CART_BUTTON_ID_PREFIX = 'earthora_cart';
const ACTION_INPUT_PREFIX = '__earthora_whatsapp_product_action__:';
const CART_ACTION_INPUT_PREFIX = '__earthora_whatsapp_cart_action__:';
const PERSISTED_CARD_PREFIX = '__earthora_whatsapp_product_card__:';

export function productButtonId(action: WhatsAppProductAction, productId: string): string {
  return `${BUTTON_ID_PREFIX}:${action}:${encodeURIComponent(productId)}`;
}

export function cartButtonId(action: WhatsAppCartAction): string {
  return `${CART_BUTTON_ID_PREFIX}:${action}`;
}

export function productActionInputFromButtonId(buttonId: unknown): string | null {
  if (typeof buttonId !== 'string') return null;
  const match = buttonId.match(/^earthora_product:(benefits|dosage|add_to_cart):(.+)$/u);
  if (match) {
    try {
      const productId = decodeURIComponent(match[2]);
      return productId ? `${ACTION_INPUT_PREFIX}${match[1]}:${encodeURIComponent(productId)}` : null;
    } catch {
      return null;
    }
  }
  const cartMatch = buttonId.match(/^earthora_cart:(view_cart|checkout|continue_shopping|main_menu)$/u);
  if (cartMatch) {
    return `${CART_ACTION_INPUT_PREFIX}${cartMatch[1]}`;
  }
  return null;
}

export function parseCartActionInput(input: string): WhatsAppCartAction | null {
  if (typeof input !== 'string') return null;
  const match =
    input.match(/^__earthora_whatsapp_cart_action__:(view_cart|checkout|continue_shopping|main_menu)$/u) ??
    input.match(/^earthora_cart:(view_cart|checkout|continue_shopping|main_menu)$/u);
  if (match) return match[1] as WhatsAppCartAction;
  return null;
}

export function parseProductActionInput(input: string): { action: WhatsAppProductAction; productId: string } | null {
  if (typeof input !== 'string') return null;
  const match =
    input.match(/^__earthora_whatsapp_product_action__:(benefits|dosage|add_to_cart):(.+)$/u) ??
    input.match(/^earthora_product:(benefits|dosage|add_to_cart):(.+)$/u);
  if (!match) return null;
  try {
    const productId = decodeURIComponent(match[2]);
    return productId ? { action: match[1] as WhatsAppProductAction, productId } : null;
  } catch {
    return null;
  }
}

const BENEFITS_PATTERN = /^(?:benefits?|fayde|फायदे|लाभ|ફાયદા)[\s!.?,]*$/iu;
const DOSAGE_PATTERN = /^(?:dosage|dose|directions?|uses?|khurak|खुराक|ખોરાક|मात्रा|માત્રા|ઉપયોગ)[\s!.?,]*$/iu;
const ADD_TO_CART_PATTERN = /^(?:add\s+to\s+cart|buy|order|कार्ट\s+में\s+जोड़ें|કાર્ટમાં\s+ઉમેરો)[\s!.?,]*$/iu;

export function parseProductActionFromText(
  text: string,
  contextProductId?: string,
): { action: WhatsAppProductAction; productId: string } | null {
  if (!contextProductId || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (BENEFITS_PATTERN.test(trimmed)) {
    return { action: 'benefits', productId: contextProductId };
  }
  if (DOSAGE_PATTERN.test(trimmed)) {
    return { action: 'dosage', productId: contextProductId };
  }
  if (ADD_TO_CART_PATTERN.test(trimmed)) {
    return { action: 'add_to_cart', productId: contextProductId };
  }
  return null;
}

export function serializeProductCard(card: WhatsAppProductCard): string {
  return `${PERSISTED_CARD_PREFIX}${encodeURIComponent(JSON.stringify(card))}`;
}

export function parsePersistedProductCard(value: string | null): WhatsAppProductCard | null {
  if (!value?.startsWith(PERSISTED_CARD_PREFIX)) return null;
  try {
    const card = JSON.parse(decodeURIComponent(value.slice(PERSISTED_CARD_PREFIX.length))) as Partial<WhatsAppProductCard>;
    const hasValidImage = card.imageUrl === undefined || card.imageUrl === null ||
      (typeof card.imageUrl === 'string' && /^https:\/\//i.test(card.imageUrl));
    const hasValidButtons = card.buttons === undefined || (Array.isArray(card.buttons) && card.buttons.every(
      (b) => b && typeof b === 'object' && typeof b.id === 'string' && typeof b.title === 'string'
    ));
    if (typeof card.body !== 'string' || !hasValidImage || !hasValidButtons) return null;
    return {
      ...(typeof card.productId === 'string' ? { productId: card.productId } : {}),
      ...(typeof card.name === 'string' ? { name: card.name } : {}),
      body: card.body,
      ...(card.imageUrl ? { imageUrl: card.imageUrl } : {}),
      ...(Array.isArray(card.buttons) ? { buttons: card.buttons } : {}),
    };
  } catch {
    return null;
  }
}
