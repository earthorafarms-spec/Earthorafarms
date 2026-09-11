import { config } from '../voice-service/src/config.js';
import { productButtonId, type WhatsAppProductCard } from './product-card.js';

export class WhatsAppDeliveryError extends Error {
  constructor(readonly status: number, readonly responseBody?: string) {
    const details = responseBody ? `: ${responseBody.slice(0, 300)}` : '';
    super(`WhatsApp provider rejected delivery (HTTP ${status})${details}`);
    this.name = 'WhatsAppDeliveryError';
  }
}

async function assertResponseOk(res: Response): Promise<void> {
  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new WhatsAppDeliveryError(res.status, errorBody);
  }
}

async function sendWhatsAppPayload(payload: Record<string, unknown>): Promise<void> {
  const url = `https://graph.facebook.com/v21.0/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8_000),
  });

  await assertResponseOk(res);
}

export function buildCheckoutTemplatePayload(to: string, reviewUrl: string): Record<string, unknown> {
  const phone = to.startsWith('+') ? to : `+${to}`;
  return {
    to: phone,
    type: 'template',
    source: 'external',
    template: {
      name: config.WHATSAPP_CHECKOUT_TEMPLATE_NAME,
      language: { code: config.WHATSAPP_CHECKOUT_TEMPLATE_LANGUAGE },
      components: [{
        type: 'body',
        parameters: [{ type: 'text', text: reviewUrl }],
      }],
    },
  };
}

async function sendTataOmniCheckoutTemplate(to: string, reviewUrl: string): Promise<void> {
  if (!config.TATA_OMNI_ACCESS_TOKEN || !config.WHATSAPP_CHECKOUT_TEMPLATE_NAME) {
    throw new Error('Tata Omni WhatsApp checkout delivery is not configured');
  }

  const url = `${config.TATA_OMNI_API_BASE_URL.replace(/\/$/, '')}/whatsapp-cloud/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Tata Omni documents this as a raw API-key header, not a Bearer token.
      Authorization: config.TATA_OMNI_ACCESS_TOKEN,
    },
    body: JSON.stringify(buildCheckoutTemplatePayload(to, reviewUrl)),
    signal: AbortSignal.timeout(8_000),
  });

  await assertResponseOk(res);
}

export function buildTataOmniTextPayload(to: string, text: string): Record<string, unknown> {
  const phone = to.startsWith('+') ? to : `+${to}`;
  return {
    to: phone,
    type: 'text',
    source: 'external',
    text: { preview_url: false, body: text },
  };
}

export function buildTataOmniImagePayload(
  to: string,
  imageUrl: string,
  caption?: string,
): Record<string, unknown> {
  const phone = to.startsWith('+') ? to : `+${to}`;
  return {
    to: phone,
    type: 'image',
    source: 'external',
    image: {
      link: imageUrl,
      ...(caption ? { caption } : {}),
    },
  };
}

export function buildTataOmniDocumentPayload(
  to: string,
  documentUrl: string,
  filename: string,
  caption: string,
): Record<string, unknown> {
  const phone = to.startsWith('+') ? to : `+${to}`;
  return {
    to: phone,
    type: 'document',
    source: 'external',
    document: { link: documentUrl, filename, caption },
  };
}

export function buildInvoiceTemplatePayload(
  to: string,
  documentUrl: string,
  filename: string,
  orderNumber: string,
  paidAmount: string,
): Record<string, unknown> {
  const phone = to.startsWith('+') ? to : `+${to}`;
  return {
    to: phone,
    type: 'template',
    source: 'external',
    template: {
      name: config.WHATSAPP_INVOICE_TEMPLATE_NAME,
      language: { code: config.WHATSAPP_INVOICE_TEMPLATE_LANGUAGE },
      components: [
        {
          type: 'header',
          parameters: [{ type: 'document', document: { link: documentUrl, filename } }],
        },
        {
          type: 'body',
          parameters: [{ type: 'text', text: orderNumber }, { type: 'text', text: paidAmount }],
        },
      ],
    },
  };
}

function productCardInteractive(card: WhatsAppProductCard): Record<string, unknown> {
  const hasValidImage = typeof card.imageUrl === 'string' && /^https:\/\//i.test(card.imageUrl);
  const buttons = Array.isArray(card.buttons) && card.buttons.length > 0
    ? card.buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } }))
    : [
        { type: 'reply', reply: { id: productButtonId('benefits', card.productId ?? ''), title: 'Benefits' } },
        { type: 'reply', reply: { id: productButtonId('dosage', card.productId ?? ''), title: 'Dosage' } },
        { type: 'reply', reply: { id: productButtonId('add_to_cart', card.productId ?? ''), title: 'Add to Cart' } },
      ];
  return {
    type: 'button',
    ...(hasValidImage ? { header: { type: 'image', image: { link: card.imageUrl } } } : {}),
    body: { text: card.body },
    action: {
      buttons,
    },
  };
}

export function buildTataOmniProductCardPayload(
  to: string,
  card: WhatsAppProductCard,
): Record<string, unknown> {
  const phone = to.startsWith('+') ? to : `+${to}`;
  return { to: phone, type: 'interactive', source: 'external', interactive: productCardInteractive(card) };
}

export function buildMetaProductCardPayload(
  to: string,
  card: WhatsAppProductCard,
): Record<string, unknown> {
  const phone = to.startsWith('+') ? to.slice(1) : to;
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'interactive',
    interactive: productCardInteractive(card),
  };
}

async function sendTataOmniText(to: string, text: string): Promise<void> {
  if (!config.TATA_OMNI_ACCESS_TOKEN) throw new Error('Tata Omni WhatsApp delivery is not configured');
  const url = `${config.TATA_OMNI_API_BASE_URL.replace(/\/$/, '')}/whatsapp-cloud/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: config.TATA_OMNI_ACCESS_TOKEN },
    body: JSON.stringify(buildTataOmniTextPayload(to, text)),
    signal: AbortSignal.timeout(8_000),
  });
  await assertResponseOk(res);
}

// Sends a customer-service-window reply through the configured provider.
export async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  if (config.WHATSAPP_PROVIDER === 'tata_omni') {
    await sendTataOmniText(to, text);
    return;
  }
  const phone = to.startsWith('+') ? to.slice(1) : to; // Meta expects no leading +
  await sendWhatsAppPayload({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'text',
    text: { preview_url: false, body: text },
  });
}

/** Sends a public HTTPS product image in the active customer-service conversation. */
export async function sendWhatsAppImage(to: string, imageUrl: string, caption?: string): Promise<void> {
  if (!/^https:\/\//i.test(imageUrl)) throw new Error('WhatsApp image URL must use HTTPS');

  if (config.WHATSAPP_PROVIDER === 'tata_omni') {
    if (!config.TATA_OMNI_ACCESS_TOKEN) throw new Error('Tata Omni WhatsApp delivery is not configured');
    const url = `${config.TATA_OMNI_API_BASE_URL.replace(/\/$/, '')}/whatsapp-cloud/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: config.TATA_OMNI_ACCESS_TOKEN },
      body: JSON.stringify(buildTataOmniImagePayload(to, imageUrl, caption)),
      signal: AbortSignal.timeout(8_000),
    });
    await assertResponseOk(res);
    return;
  }

  const phone = to.startsWith('+') ? to.slice(1) : to;
  await sendWhatsAppPayload({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'image',
    image: { link: imageUrl, ...(caption ? { caption } : {}) },
  });
}

/** Sends the verified paid-order invoice as a PDF document. */
export async function sendWhatsAppInvoice(
  to: string,
  documentUrl: string,
  filename: string,
  orderNumber: string,
  paidAmount: string,
): Promise<void> {
  if (!/^https:\/\//i.test(documentUrl)) throw new Error('WhatsApp invoice URL must use HTTPS');
  const caption = `Earthora Farms bill for order ${orderNumber}. Paid amount: ${paidAmount}.`;

  if (config.WHATSAPP_PROVIDER === 'tata_omni') {
    if (!config.TATA_OMNI_ACCESS_TOKEN) throw new Error('Tata Omni WhatsApp delivery is not configured');
    const payload = config.WHATSAPP_INVOICE_TEMPLATE_NAME
      ? buildInvoiceTemplatePayload(to, documentUrl, filename, orderNumber, paidAmount)
      : buildTataOmniDocumentPayload(to, documentUrl, filename, caption);
    const url = `${config.TATA_OMNI_API_BASE_URL.replace(/\/$/, '')}/whatsapp-cloud/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: config.TATA_OMNI_ACCESS_TOKEN },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    await assertResponseOk(res);
    return;
  }

  const phone = to.startsWith('+') ? to.slice(1) : to;
  if (config.WHATSAPP_INVOICE_TEMPLATE_NAME) {
    const payload = buildInvoiceTemplatePayload(phone, documentUrl, filename, orderNumber, paidAmount);
    delete (payload as { source?: string }).source;
    Object.assign(payload, { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone });
    await sendWhatsAppPayload(payload);
    return;
  }
  await sendWhatsAppPayload({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'document',
    document: { link: documentUrl, filename, caption },
  });
}

/** Sends one native image-header message with three deterministic reply buttons. */
export async function sendWhatsAppProductCard(to: string, card: WhatsAppProductCard): Promise<void> {
  if (card.imageUrl && !/^https:\/\//i.test(card.imageUrl)) throw new Error('WhatsApp image URL must use HTTPS');

  if (config.WHATSAPP_PROVIDER === 'tata_omni') {
    if (!config.TATA_OMNI_ACCESS_TOKEN) throw new Error('Tata Omni WhatsApp delivery is not configured');
    const url = `${config.TATA_OMNI_API_BASE_URL.replace(/\/$/, '')}/whatsapp-cloud/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: config.TATA_OMNI_ACCESS_TOKEN },
      body: JSON.stringify(buildTataOmniProductCardPayload(to, card)),
      signal: AbortSignal.timeout(8_000),
    });
    await assertResponseOk(res);
    return;
  }

  await sendWhatsAppPayload(buildMetaProductCardPayload(to, card));
}

/**
 * Sends the review-form link. Voice calls are business-initiated WhatsApp
 * conversations, so an approved template is used when configured. A plain
 * text fallback remains useful when this tool runs inside an already-active
 * WhatsApp customer-service conversation.
 *
 * Expected template body: one text placeholder ({{1}}) for `reviewUrl`.
 */
export async function sendWhatsAppCheckoutForm(to: string, reviewUrl: string): Promise<void> {
  if (config.WHATSAPP_PROVIDER === 'tata_omni') {
    await sendTataOmniCheckoutTemplate(to, reviewUrl);
    return;
  }

  const phone = to.startsWith('+') ? to.slice(1) : to;
  if (config.WHATSAPP_CHECKOUT_TEMPLATE_NAME) {
    await sendWhatsAppPayload({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'template',
      template: {
        name: config.WHATSAPP_CHECKOUT_TEMPLATE_NAME,
        language: { code: config.WHATSAPP_CHECKOUT_TEMPLATE_LANGUAGE },
        components: [{
          type: 'body',
          parameters: [{ type: 'text', text: reviewUrl }],
        }],
      },
    });
    return;
  }

  await sendWhatsAppMessage(
    phone,
    `Please review and edit your Earthora Farms order here: ${reviewUrl}\n\n` +
    'Razorpay payment will be available only after you confirm the form.'
  );
}

function buildLowStockTemplatePayload(
  to: string,
  productName: string,
  stockAtAlert: number,
  threshold: number,
): Record<string, unknown> {
  const phone = to.startsWith('+') ? to : `+${to}`;
  return {
    to: phone,
    type: 'template',
    source: 'external',
    template: {
      name: config.WHATSAPP_LOW_STOCK_TEMPLATE_NAME,
      language: { code: config.WHATSAPP_LOW_STOCK_TEMPLATE_LANGUAGE },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: productName },
          { type: 'text', text: String(stockAtAlert) },
          { type: 'text', text: String(threshold) },
        ],
      }],
    },
  };
}

/**
 * Sends a dispatch-team low-stock alert. An approved utility template is
 * used whenever configured so alerts can be delivered outside the 24-hour
 * WhatsApp service window; otherwise the active-conversation text path is
 * retained for local testing and open admin chats.
 */
export async function sendWhatsAppLowStockAlert(
  to: string,
  productName: string,
  stockAtAlert: number,
  threshold: number,
): Promise<void> {
  const message = [
    '⚠️ Earthora Farms low-stock alert',
    `Product: ${productName}`,
    `Current stock: ${stockAtAlert} unit${stockAtAlert === 1 ? '' : 's'}`,
    `Alert threshold: ${threshold} units`,
    stockAtAlert <= 0
      ? 'The latest order has exhausted the available stock. Please arrange replenishment before dispatch.'
      : 'Please arrange fresh stock at the dispatch location soon.',
  ].join('\n');

  if (!config.WHATSAPP_LOW_STOCK_TEMPLATE_NAME) {
    await sendWhatsAppMessage(to, message);
    return;
  }

  if (config.WHATSAPP_PROVIDER === 'tata_omni') {
    if (!config.TATA_OMNI_ACCESS_TOKEN) throw new Error('Tata Omni WhatsApp delivery is not configured');
    const url = `${config.TATA_OMNI_API_BASE_URL.replace(/\/$/, '')}/whatsapp-cloud/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: config.TATA_OMNI_ACCESS_TOKEN },
      body: JSON.stringify(buildLowStockTemplatePayload(to, productName, stockAtAlert, threshold)),
      signal: AbortSignal.timeout(8_000),
    });
    await assertResponseOk(res);
    return;
  }

  const phone = to.startsWith('+') ? to.slice(1) : to;
  const payload = buildLowStockTemplatePayload(phone, productName, stockAtAlert, threshold);
  delete (payload as { source?: string }).source;
  Object.assign(payload, { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone });
  await sendWhatsAppPayload(payload);
}

/**
 * Normalizes customer phone numbers for WhatsApp shipment tracking delivery.
 * - 10-digit Indian numbers (e.g. 9825346884) -> +919825346884
 * - 11-digit leading-zero Indian numbers (e.g. 09825346884) -> +919825346884
 * - 12-digit Indian numbers without plus (e.g. 919825346884) -> +919825346884
 * - Already prefixed +91 numbers (e.g. +919825346884) -> +919825346884
 * - Valid international numbers (e.g. +14155552671, +447911123456, +971501234567) -> preserved
 * - Invalid numbers (too short, non-numeric, invalid E.164) -> null
 */
export function normalizeTrackingPhone(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');

  if (trimmed.startsWith('+')) {
    if (/^[1-9]\d{7,14}$/.test(digits)) {
      return `+${digits}`;
    }
    return null;
  }

  // Raw numbers without leading +
  if (/^[6-9]\d{9}$/.test(digits)) {
    return `+91${digits}`;
  }
  if (/^0[6-9]\d{9}$/.test(digits)) {
    return `+91${digits.slice(1)}`;
  }
  if (/^91[6-9]\d{9}$/.test(digits)) {
    return `+${digits}`;
  }
  if (/^[1-9]\d{7,14}$/.test(digits)) {
    return `+${digits}`;
  }
  return null;
}

function buildTrackingTemplatePayload(
  to: string,
  orderNumber: string,
  trackingUrl: string,
): Record<string, unknown> {
  const phone = to.startsWith('+') ? to : `+${to}`;
  return {
    to: phone,
    type: 'template',
    source: 'external',
    template: {
      name: config.WHATSAPP_TRACKING_TEMPLATE_NAME,
      language: { code: config.WHATSAPP_TRACKING_TEMPLATE_LANGUAGE },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: orderNumber },
          { type: 'text', text: trackingUrl },
        ],
      }],
    },
  };
}

/** Sends a shipment tracking update requested by the verified admin portal. */
export async function sendWhatsAppTrackingUpdate(
  to: string,
  orderNumber: string,
  trackingUrl: string,
): Promise<void> {
  const normalizedPhone = normalizeTrackingPhone(to);
  if (!normalizedPhone) {
    throw new Error(`Invalid recipient phone number for tracking update: ${to}`);
  }
  const message = `Your Earthora Farms order ${orderNumber} has a delivery tracking update. Track it here: ${trackingUrl}`;

  if (config.WHATSAPP_PROVIDER === 'tata_omni') {
    if (!config.TATA_OMNI_ACCESS_TOKEN) throw new Error('Tata Omni WhatsApp delivery is not configured');
    // Shipment notifications are usually sent after WhatsApp's 24-hour
    // customer-service window. A plain text message can be accepted by the
    // provider but never reach the customer, so fail explicitly instead of
    // recording a false "tracking sent" result.
    if (!config.WHATSAPP_TRACKING_TEMPLATE_NAME) {
      throw new Error('An approved WhatsApp tracking template is required before tracking updates can be delivered');
    }
    const payload = buildTrackingTemplatePayload(normalizedPhone, orderNumber, trackingUrl);
    const url = `${config.TATA_OMNI_API_BASE_URL.replace(/\/$/, '')}/whatsapp-cloud/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: config.TATA_OMNI_ACCESS_TOKEN },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    await assertResponseOk(res);
    return;
  }

  const phone = normalizedPhone.startsWith('+') ? normalizedPhone.slice(1) : normalizedPhone;
  if (config.WHATSAPP_TRACKING_TEMPLATE_NAME) {
    const payload = buildTrackingTemplatePayload(phone, orderNumber, trackingUrl);
    delete (payload as { source?: string }).source;
    Object.assign(payload, { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone });
    await sendWhatsAppPayload(payload);
    return;
  }
  await sendWhatsAppMessage(phone, message);
}
