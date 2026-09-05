import { config } from '../config.js';

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

// Sends a plain-text message via the Meta (WhatsApp Business) Cloud API.
// The `to` parameter must be E.164 (with or without the leading +).
export async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  const phone = to.startsWith('+') ? to.slice(1) : to; // Meta expects no leading +
  await sendWhatsAppPayload({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'text',
    text: { preview_url: false, body: text },
  });
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
