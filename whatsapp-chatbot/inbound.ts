export interface WhatsAppInboundMessage {
  providerMessageId: string;
  phone: string;
  text: string | null;
  kind: 'text' | 'unsupported';
}

function asRecord(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, any> : null;
}

function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

function metaMessageText(message: Record<string, any>): string | null {
  if (message.type === 'text' && typeof message.text?.body === 'string') {
    return message.text.body.trim();
  }
  if (message.type === 'interactive') {
    const text = message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title;
    return typeof text === 'string' ? text.trim() : null;
  }
  if (message.type === 'button' && typeof message.button?.text === 'string') {
    return message.button.text.trim();
  }
  return null;
}

function extractMetaMessages(body: Record<string, any>): WhatsAppInboundMessage[] {
  if (body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) return [];
  const result: WhatsAppInboundMessage[] = [];

  for (const entry of body.entry) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      for (const rawMessage of Array.isArray(change?.value?.messages) ? change.value.messages : []) {
        const message = asRecord(rawMessage);
        const phone = normalizePhone(message?.from);
        const providerMessageId = typeof message?.id === 'string' ? message.id : null;
        if (!message || !phone || !providerMessageId) continue;
        const text = metaMessageText(message);
        result.push({
          providerMessageId,
          phone,
          text: text || null,
          kind: text ? 'text' : 'unsupported',
        });
      }
    }
  }
  return result;
}

/**
 * Tata Omni allows an additional callback URL but does not publish a stable
 * callback JSON schema in its public setup guide. Keep the normalization at
 * this boundary: it accepts the common flat/enveloped fields seen in Omni
 * callbacks without leaking provider-specific shapes into the conversation
 * or checkout layers. Captured production fixtures should be added here when
 * the account's exact callback payload is available.
 */
function extractNormalizedProviderMessage(body: Record<string, any>): WhatsAppInboundMessage[] {
  const envelope = asRecord(body.payload) ?? asRecord(body.data) ?? body;
  // Tata Omni currently sends `messages` as one object, while other callback
  // variants use either `message` or a `messages` array.
  const rawMessages = Array.isArray(envelope.messages)
    ? envelope.messages
    : asRecord(envelope.messages)
      ? [envelope.messages]
      : [asRecord(envelope.message) ?? envelope];

  const result: WhatsAppInboundMessage[] = [];
  for (const rawMessage of rawMessages) {
    const message = asRecord(rawMessage);
    if (!message) continue;
    const sender = asRecord(envelope.sender) ?? asRecord(envelope.contact) ?? asRecord(message.sender);

    const providerMessageId = [
      message.id,
      message.message_id,
      message.messageId,
      envelope.message_id,
      envelope.messageId,
    ].find((value) => typeof value === 'string' && value.length > 0) as string | undefined;

    const phone = normalizePhone(
      message.from ?? message.source ?? envelope.from ?? envelope.source ?? sender?.phone ?? sender?.wa_id
    );

    const rawText =
      (typeof message.text === 'string' ? message.text : message.text?.body) ??
      message.content?.text ??
      (typeof message.content === 'string' ? message.content : undefined) ??
      message.payload?.text ??
      message.payload?.title;
    const text = typeof rawText === 'string' ? rawText.trim() : null;

    if (!providerMessageId || !phone) continue;
    result.push({
      providerMessageId,
      phone,
      text: text || null,
      kind: text ? 'text' : 'unsupported',
    });
  }
  return result;
}

export function extractWhatsAppInboundMessages(body: unknown): WhatsAppInboundMessage[] {
  const record = asRecord(body);
  if (!record) return [];
  const meta = extractMetaMessages(record);
  return meta.length > 0 ? meta : extractNormalizedProviderMessage(record);
}
