import { describe, expect, it } from 'vitest';
import { extractWhatsAppInboundMessages } from '../../whatsapp-chatbot/inbound.js';

describe('WhatsApp inbound normalization', () => {
  it('extracts Tata Omni callbacks whose messages field is a single object', () => {
    const messages = extractWhatsAppInboundMessages({
      businessPhoneNumber: '919999999999',
      contacts: [{ profile: { name: 'Customer' }, user_id: 'user-1', wa_id: '919876543210' }],
      id: 'callback-1',
      messages: {
        from: '919876543210',
        from_user_id: 'user-1',
        id: 'wamid.test',
        text: { body: '  Hi  ' },
        timestamp: '1788614212',
        type: 'text',
      },
    });

    expect(messages).toEqual([{
      providerMessageId: 'wamid.test',
      phone: '+919876543210',
      text: 'Hi',
      kind: 'text',
    }]);
  });
});
