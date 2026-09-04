import { describe, expect, it } from 'vitest';
import { buildCheckoutTemplatePayload } from '../../src/adapters/meta-cloud.js';

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
});
