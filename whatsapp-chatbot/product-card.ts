export type WhatsAppProductAction = 'benefits' | 'dosage' | 'add_to_cart';

export interface WhatsAppProductCard {
  productId: string;
  imageUrl?: string;
  name: string;
  body: string;
}

const BUTTON_ID_PREFIX = 'earthora_product';
const ACTION_INPUT_PREFIX = '__earthora_whatsapp_product_action__:';
const PERSISTED_CARD_PREFIX = '__earthora_whatsapp_product_card__:';

export function productButtonId(action: WhatsAppProductAction, productId: string): string {
  return `${BUTTON_ID_PREFIX}:${action}:${encodeURIComponent(productId)}`;
}

export function productActionInputFromButtonId(buttonId: unknown): string | null {
  if (typeof buttonId !== 'string') return null;
  const match = buttonId.match(/^earthora_product:(benefits|dosage|add_to_cart):(.+)$/u);
  if (!match) return null;
  try {
    const productId = decodeURIComponent(match[2]);
    return productId ? `${ACTION_INPUT_PREFIX}${match[1]}:${encodeURIComponent(productId)}` : null;
  } catch {
    return null;
  }
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
    return typeof card.productId === 'string' && typeof card.name === 'string' &&
      typeof card.body === 'string' && hasValidImage
      ? {
          productId: card.productId,
          name: card.name,
          body: card.body,
          ...(card.imageUrl ? { imageUrl: card.imageUrl } : {}),
        }
      : null;
  } catch {
    return null;
  }
}
