import { config } from '../config.js';

// Sends a plain-text message via the Meta (WhatsApp Business) Cloud API.
// The `to` parameter must be E.164 (with or without the leading +).
export async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  const phone = to.startsWith('+') ? to.slice(1) : to; // Meta expects no leading +
  const url = `https://graph.facebook.com/v21.0/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'text',
      text: { preview_url: false, body: text },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`WhatsApp send failed ${res.status}: ${body}`);
  }
}
