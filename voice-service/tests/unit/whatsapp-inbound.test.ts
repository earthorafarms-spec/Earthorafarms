import { describe, expect, it } from 'vitest';
import { extractWhatsAppInboundMessages } from '../../../whatsapp-chatbot/inbound.js';

describe('WhatsApp inbound normalization', () => {
  it('extracts every Meta text and interactive reply across entries', () => {
    const messages = extractWhatsAppInboundMessages({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { messages: [
        { id: 'wamid.1', from: '919876543210', type: 'text', text: { body: 'Two powders' } },
        { id: 'wamid.2', from: '919876543210', type: 'interactive', interactive: { button_reply: { title: 'Yes' } } },
      ] } }] }],
    });

    expect(messages).toEqual([
      { providerMessageId: 'wamid.1', phone: '+919876543210', text: 'Two powders', kind: 'text' },
      { providerMessageId: 'wamid.2', phone: '+919876543210', text: 'Yes', kind: 'text' },
    ]);
  });

  it('normalizes a flat/enveloped Omni callback without coupling downstream code to it', () => {
    expect(extractWhatsAppInboundMessages({
      payload: {
        message: { id: 'omni-1', type: 'text', content: { text: 'Show products' } },
        sender: { phone: '+91 98765 43210' },
      },
    })).toEqual([
      { providerMessageId: 'omni-1', phone: '+919876543210', text: 'Show products', kind: 'text' },
    ]);
  });

  it('ignores delivery receipts and labels unsupported inbound media', () => {
    expect(extractWhatsAppInboundMessages({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { statuses: [{ id: 'x' }] } }] }] })).toEqual([]);
    expect(extractWhatsAppInboundMessages({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { messages: [{ id: 'wamid.audio', from: '919876543210', type: 'audio' }] } }] }],
    })).toEqual([
      { providerMessageId: 'wamid.audio', phone: '+919876543210', text: null, kind: 'unsupported' },
    ]);
  });
});
