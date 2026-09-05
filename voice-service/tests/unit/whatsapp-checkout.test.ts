import { describe, expect, it } from 'vitest';
import { buildCheckoutTemplatePayload, buildTataOmniTextPayload } from '../../../whatsapp-chatbot/provider.js';

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
});
