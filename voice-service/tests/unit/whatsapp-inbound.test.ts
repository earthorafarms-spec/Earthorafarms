import { describe, expect, it } from 'vitest';
import { extractWhatsAppInboundMessages } from '../../../whatsapp-chatbot/inbound.js';
import {
  parseProductActionFromText,
  parseProductActionInput,
  productActionInputFromButtonId,
  productButtonId,
} from '../../../whatsapp-chatbot/product-card.js';

describe('WhatsApp inbound normalization', () => {
  it('extracts every Meta text and interactive reply across entries', () => {
    const messages = extractWhatsAppInboundMessages({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { messages: [
        { id: 'wamid.1', from: '919876543210', type: 'text', text: { body: 'Two powders' } },
        {
          id: 'wamid.2', from: '919876543210', type: 'interactive',
          interactive: { button_reply: { id: productButtonId('benefits', 'alpha-id'), title: 'Benefits' } },
        },
      ] } }] }],
    });

    expect(messages).toEqual([
      { providerMessageId: 'wamid.1', phone: '+919876543210', text: 'Two powders', kind: 'text' },
      {
        providerMessageId: 'wamid.2', phone: '+919876543210',
        text: productActionInputFromButtonId(productButtonId('benefits', 'alpha-id')), kind: 'text',
      },
    ]);
  });

  it('normalizes a provider interactive button ID for deterministic routing', () => {
    const messages = extractWhatsAppInboundMessages({
      payload: {
        message: {
          id: 'omni-button-1', type: 'interactive',
          content: { buttonId: productButtonId('add_to_cart', 'alpha-id'), buttonTitle: 'Add to Cart' },
        },
        sender: { phone: '+91 98765 43210' },
      },
    });

    expect(messages[0]?.text).toBe(productActionInputFromButtonId(productButtonId('add_to_cart', 'alpha-id')));
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

  it('normalizes Meta type:button payloads where button ID is in payload', () => {
    const messages = extractWhatsAppInboundMessages({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { messages: [
        {
          id: 'wamid.button.1',
          from: '919876543210',
          type: 'button',
          button: { payload: productButtonId('dosage', 'alpha-id'), text: 'Dosage' },
        },
      ] } }] }],
    });

    expect(messages).toEqual([{
      providerMessageId: 'wamid.button.1',
      phone: '+919876543210',
      text: productActionInputFromButtonId(productButtonId('dosage', 'alpha-id')),
      kind: 'text',
    }]);
  });

  it('normalizes Tata Omni interactive button callback with single messages object', () => {
    const messages = extractWhatsAppInboundMessages({
      businessPhoneNumber: '919999999999',
      contacts: [{ profile: { name: 'Customer' }, user_id: 'user-1', wa_id: '919876543210' }],
      id: 'omni-cb-1',
      messages: {
        from: '919876543210',
        id: 'wamid.omni.interactive',
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: productButtonId('benefits', 'mori-1'), title: 'Benefits' },
        },
      },
    });

    expect(messages).toEqual([{
      providerMessageId: 'wamid.omni.interactive',
      phone: '+919876543210',
      text: productActionInputFromButtonId(productButtonId('benefits', 'mori-1')),
      kind: 'text',
    }]);
  });

  it('normalizes provider camelCase buttonReply and content button_id payloads', () => {
    const camelCaseMessages = extractWhatsAppInboundMessages({
      payload: {
        message: {
          id: 'omni-camel-1',
          type: 'interactive',
          interactive: { buttonReply: { id: productButtonId('add_to_cart', 'alpha-id'), title: 'Add to Cart' } },
        },
        sender: { phone: '+919876543210' },
      },
    });
    expect(camelCaseMessages[0]?.text).toBe(productActionInputFromButtonId(productButtonId('add_to_cart', 'alpha-id')));

    const altFieldMessages = extractWhatsAppInboundMessages({
      payload: {
        message: {
          id: 'omni-alt-1',
          type: 'interactive',
          content: { button_id: productButtonId('benefits', 'alpha-id'), button_title: 'Benefits' },
        },
        sender: { phone: '+919876543210' },
      },
    });
    expect(altFieldMessages[0]?.text).toBe(productActionInputFromButtonId(productButtonId('benefits', 'alpha-id')));
  });

  it('parses raw button IDs as well as internal action inputs', () => {
    expect(parseProductActionInput(productButtonId('benefits', 'mori-1'))).toEqual({
      action: 'benefits',
      productId: 'mori-1',
    });
    expect(parseProductActionInput(productButtonId('dosage', 'mori-1'))).toEqual({
      action: 'dosage',
      productId: 'mori-1',
    });
    expect(parseProductActionInput(productButtonId('add_to_cart', 'mori-1'))).toEqual({
      action: 'add_to_cart',
      productId: 'mori-1',
    });
  });

  it('maps button titles to product actions when context product ID is present', () => {
    expect(parseProductActionFromText('Benefits', 'mori-1')).toEqual({ action: 'benefits', productId: 'mori-1' });
    expect(parseProductActionFromText('Dosage', 'mori-1')).toEqual({ action: 'dosage', productId: 'mori-1' });
    expect(parseProductActionFromText('Add to Cart', 'mori-1')).toEqual({ action: 'add_to_cart', productId: 'mori-1' });
    expect(parseProductActionFromText('फायदे', 'mori-1')).toEqual({ action: 'benefits', productId: 'mori-1' });
    expect(parseProductActionFromText('ખુરાક', 'mori-1')).toBeNull();
    expect(parseProductActionFromText('માત્રા', 'mori-1')).toEqual({ action: 'dosage', productId: 'mori-1' });
    expect(parseProductActionFromText('Benefits', undefined)).toBeNull();
  });
});
