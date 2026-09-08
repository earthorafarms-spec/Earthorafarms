import { describe, expect, it } from 'vitest';
import {
  buildCheckoutTemplatePayload,
  buildMetaProductCardPayload,
  buildTataOmniImagePayload,
  buildTataOmniProductCardPayload,
  buildTataOmniTextPayload,
} from '../../../whatsapp-chatbot/provider.js';
import { parsePersistedProductCard, serializeProductCard } from '../../../whatsapp-chatbot/product-card.js';

describe('WhatsApp checkout template payload', () => {
  it('uses Tata Omni international-number and template-variable format', () => {
    const payload = buildCheckoutTemplatePayload(
      '919876543210',
      'https://earthorafarms.com/voice-checkout/test'
    );

    expect(payload).toMatchObject({
      to: '+919876543210',
      type: 'template',
      source: 'external',
      template: {
        language: { code: 'en' },
        components: [{
          type: 'body',
          parameters: [{ type: 'text', text: 'https://earthorafarms.com/voice-checkout/test' }],
        }],
      },
    });
  });

  it('uses the Tata Omni customer-service text shape for chatbot replies', () => {
    expect(buildTataOmniTextPayload('919876543210', 'How can I help?')).toEqual({
      to: '+919876543210',
      type: 'text',
      source: 'external',
      text: { preview_url: false, body: 'How can I help?' },
    });
  });

  it('uses the Tata Omni public-link image shape for the live primary product photo', () => {
    expect(buildTataOmniImagePayload(
      '919876543210',
      'https://cdn.example.com/product.png',
      'Morilife+',
    )).toEqual({
      to: '+919876543210',
      type: 'image',
      source: 'external',
      image: { link: 'https://cdn.example.com/product.png', caption: 'Morilife+' },
    });
  });

  it('builds native image-header product cards with three deterministic buttons', () => {
    const card = {
      productId: 'alpha-id',
      imageUrl: 'https://cdn.example.com/alpha.png',
      name: 'Alpha',
      body: '*Alpha*\n₹90 • In Stock\nDaily plant nutrition.',
    };
    const interactive = {
      type: 'button',
      header: { type: 'image', image: { link: card.imageUrl } },
      body: { text: card.body },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'earthora_product:benefits:alpha-id', title: 'Benefits' } },
          { type: 'reply', reply: { id: 'earthora_product:dosage:alpha-id', title: 'Dosage' } },
          { type: 'reply', reply: { id: 'earthora_product:add_to_cart:alpha-id', title: 'Add to Cart' } },
        ],
      },
    };

    expect(buildTataOmniProductCardPayload('919876543210', card)).toEqual({
      to: '+919876543210', type: 'interactive', source: 'external', interactive,
    });
    expect(buildMetaProductCardPayload('+919876543210', card)).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '919876543210',
      type: 'interactive', interactive,
    });
    expect(parsePersistedProductCard(serializeProductCard(card))).toEqual(card);
  });
});
