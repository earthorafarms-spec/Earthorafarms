import { describe, expect, it } from 'vitest';
import {
  sanitizeWhatsAppConversationState,
  sanitizeWhatsAppSessionMessages,
} from '../../../whatsapp-chatbot/sessions.repository.js';
import type { ConversationMessage, ConversationState } from '../../src/conversation/state.js';
import { createInitialState } from '../../src/conversation/state.js';

describe('sanitizeWhatsAppSessionMessages', () => {
  it('preserves normal user and assistant messages unchanged', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello! How can I help you today?' },
      { role: 'user', content: 'Tell me about Earthora' },
    ];

    const result = sanitizeWhatsAppSessionMessages(messages);

    expect(result).toEqual(messages);
  });

  it('preserves valid assistant tool_calls followed by matching tool results', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'What is in my cart?' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'get_cart', argumentsJson: '{}' }],
      },
      {
        role: 'tool',
        toolCallId: 'call_1',
        toolName: 'get_cart',
        content: '{"items":[]}',
      },
      { role: 'assistant', content: 'Your cart is empty.' },
    ];

    const result = sanitizeWhatsAppSessionMessages(messages);

    expect(result).toEqual(messages);
  });

  it('removes orphan tool messages not preceded by an assistant tool_calls message', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: '__earthora_whatsapp_cart_action__:checkout' },
      // Orphan checkout-direct tool message
      {
        role: 'tool',
        toolCallId: 'checkout-direct-94',
        toolName: 'create_verification_link',
        content: '{"ok":true}',
      },
      { role: 'assistant', content: 'Please fill in your details: https://example.com' },
      { role: 'user', content: 'ADARSH' },
    ];

    const result = sanitizeWhatsAppSessionMessages(messages);

    expect(result).toEqual([
      { role: 'user', content: '__earthora_whatsapp_cart_action__:checkout' },
      { role: 'assistant', content: 'Please fill in your details: https://example.com' },
      { role: 'user', content: 'ADARSH' },
    ]);
  });

  it('removes tool messages when preceding assistant message has no tool_calls', () => {
    const messages: ConversationMessage[] = [
      { role: 'assistant', content: 'I have no tools' },
      {
        role: 'tool',
        toolCallId: 'call_orphan',
        toolName: 'some_tool',
        content: '{"ok":true}',
      },
      { role: 'user', content: 'OK' },
    ];

    const result = sanitizeWhatsAppSessionMessages(messages);

    expect(result).toEqual([
      { role: 'assistant', content: 'I have no tools' },
      { role: 'user', content: 'OK' },
    ]);
  });

  it('preserves multiple tool calls in one turn and omits mismatched IDs', () => {
    const messages: ConversationMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'tool_a', argumentsJson: '{"a":1}' },
          { id: 'call_2', name: 'tool_b', argumentsJson: '{"b":2}' },
        ],
      },
      { role: 'tool', toolCallId: 'call_1', toolName: 'tool_a', content: 'result_1' },
      { role: 'tool', toolCallId: 'call_unrelated', toolName: 'orphan', content: 'orphan' },
      { role: 'tool', toolCallId: 'call_2', toolName: 'tool_b', content: 'result_2' },
      { role: 'tool', toolCallId: 'call_2', toolName: 'tool_b', content: 'duplicate' },
    ];

    const result = sanitizeWhatsAppSessionMessages(messages);

    expect(result).toEqual([
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'tool_a', argumentsJson: '{"a":1}' },
          { id: 'call_2', name: 'tool_b', argumentsJson: '{"b":2}' },
        ],
      },
      { role: 'tool', toolCallId: 'call_1', toolName: 'tool_a', content: 'result_1' },
      { role: 'tool', toolCallId: 'call_2', toolName: 'tool_b', content: 'result_2' },
    ]);
  });
});

describe('sanitizeWhatsAppConversationState', () => {
  it('cleanses orphan tool messages from state.messages while preserving all other state fields', () => {
    const state: ConversationState = {
      ...createInitialState(),
      cart: [{ productId: 'prod-1', productName: 'Moringa', quantity: 2, unitPrice: 250 }],
      checkoutFields: { name: 'Adarsh', phone: '+919876543210' },
      whatsAppProductContext: { productId: 'prod-1', productName: 'Moringa', awaitingQuantity: false, lastAction: 'benefits' },
      messages: [
        { role: 'user', content: 'Checkout' },
        { role: 'tool', toolCallId: 'checkout-direct-94', toolName: 'create_verification_link', content: '{"ok":true}' },
        { role: 'assistant', content: 'What is your email address?' },
      ],
    };

    const sanitized = sanitizeWhatsAppConversationState(state);

    expect(sanitized.cart).toEqual(state.cart);
    expect(sanitized.checkoutFields).toEqual(state.checkoutFields);
    expect(sanitized.whatsAppProductContext).toEqual(state.whatsAppProductContext);
    expect(sanitized.messages).toEqual([
      { role: 'user', content: 'Checkout' },
      { role: 'assistant', content: 'What is your email address?' },
    ]);
  });
});
