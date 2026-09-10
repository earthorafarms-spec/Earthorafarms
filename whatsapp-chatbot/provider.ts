import { config } from '../voice-service/src/config.js';
import { productButtonId, type WhatsAppProductCard } from './product-card.js';

export class WhatsAppDeliveryError extends Error {
  constructor(readonly status: number) {
    super(`WhatsApp provider rejected delivery (HTTP ${status})`);
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

  if (!res.ok) {
    throw new WhatsAppDeliveryError(res.status);
  }
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

  if (!res.ok) {
    throw new WhatsAppDeliveryError(res.status);
  }
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
  if (!res.ok) throw new WhatsAppDeliveryError(res.status);
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
    if (!res.ok) throw new WhatsAppDeliveryError(res.status);
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
    if (!res.ok) throw new WhatsAppDeliveryError(res.status);
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
    if (!res.ok) throw new WhatsAppDeliveryError(res.status);
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
    const payload = buildTrackingTemplatePayload(to, orderNumber, trackingUrl);
    const url = `${config.TATA_OMNI_API_BASE_URL.replace(/\/$/, '')}/whatsapp-cloud/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: config.TATA_OMNI_ACCESS_TOKEN },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new WhatsAppDeliveryError(res.status);
    return;
  }

  const phone = to.startsWith('+') ? to.slice(1) : to;
  if (config.WHATSAPP_TRACKING_TEMPLATE_NAME) {
    const payload = buildTrackingTemplatePayload(phone, orderNumber, trackingUrl);
    delete (payload as { source?: string }).source;
    Object.assign(payload, { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone });
    await sendWhatsAppPayload(payload);
    return;
  }
  await sendWhatsAppMessage(phone, message);
}
