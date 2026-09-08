import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WhatsAppInboxEvent } from '../../../whatsapp-chatbot/events.repository.js';
import type { WhatsAppProductCard } from '../../../whatsapp-chatbot/product-card.js';
import { serializeProductCard } from '../../../whatsapp-chatbot/product-card.js';
import { createInitialState } from '../../src/conversation/state.js';

const mockGetOrCreateSession = vi.fn();
const mockSaveWhatsAppTurn = vi.fn();
const mockMarkWhatsAppMediaSent = vi.fn();
const mockMarkWhatsAppMessageProcessed = vi.fn();
const mockProcessTurn = vi.fn();
const mockSendWhatsAppProductCard = vi.fn();
const mockSendWhatsAppImage = vi.fn();
const mockSendWhatsAppMessage = vi.fn();

vi.mock('../../../whatsapp-chatbot/sessions.repository.js', () => ({
  getOrCreateSession: (phone: string) => mockGetOrCreateSession(phone),
}));

vi.mock('../../../whatsapp-chatbot/events.repository.js', () => ({
  saveWhatsAppTurn: (...args: unknown[]) => mockSaveWhatsAppTurn(...args),
  markWhatsAppMediaSent: (...args: unknown[]) => mockMarkWhatsAppMediaSent(...args),
  markWhatsAppMessageProcessed: (...args: unknown[]) => mockMarkWhatsAppMessageProcessed(...args),
  markWhatsAppMessageFailed: vi.fn(),
  claimNextWhatsAppMessage: vi.fn(),
}));

vi.mock('../../src/conversation/controller.js', () => ({
  processTurn: (...args: unknown[]) => mockProcessTurn(...args),
}));

vi.mock('../../../whatsapp-chatbot/provider.js', () => ({
  sendWhatsAppProductCard: (...args: unknown[]) => mockSendWhatsAppProductCard(...args),
  sendWhatsAppImage: (...args: unknown[]) => mockSendWhatsAppImage(...args),
  sendWhatsAppMessage: (...args: unknown[]) => mockSendWhatsAppMessage(...args),
  WhatsAppDeliveryError: class WhatsAppDeliveryError extends Error {
    constructor(readonly status: number) {
      super(`WhatsApp delivery failed with HTTP ${status}`);
      this.name = 'WhatsAppDeliveryError';
    }
  },
}));

import { processInboxEvent } from '../../../whatsapp-chatbot/worker.js';

describe('WhatsApp worker inbox event processing & delivery retries', () => {
  const sampleCard: WhatsAppProductCard = {
    productId: 'alpha-id',
    imageUrl: 'https://cdn.example.com/alpha.png',
    name: 'Alpha Product',
    body: '*Alpha Product*\n₹90 • In Stock\nPure herbal nutrition.',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrCreateSession.mockResolvedValue({
      voiceSessionId: 'session-uuid-1',
      state: createInitialState(),
    });
    mockSaveWhatsAppTurn.mockResolvedValue(undefined);
    mockMarkWhatsAppMediaSent.mockResolvedValue(undefined);
    mockMarkWhatsAppMessageProcessed.mockResolvedValue(undefined);
    mockSendWhatsAppProductCard.mockResolvedValue(undefined);
    mockSendWhatsAppImage.mockResolvedValue(undefined);
    mockSendWhatsAppMessage.mockResolvedValue(undefined);
  });

  it('delivers a native product card successfully and suppresses redundant text message', async () => {
    const event: WhatsAppInboxEvent = {
      id: 'event-1',
      providerMessageId: 'wamid.1',
      phone: '+919876543210',
      messageText: '1',
      replyText: null,
      mediaUrl: null,
      mediaCaption: null,
      mediaSentAt: null,
      attemptCount: 1,
    };

    mockProcessTurn.mockResolvedValueOnce({
      state: createInitialState(),
      replyText: sampleCard.body,
      policyViolations: [],
      productCard: sampleCard,
      productImage: { url: sampleCard.imageUrl, caption: sampleCard.name },
    });

    await processInboxEvent(event);

    // Persists turn atomically with product card
    expect(mockSaveWhatsAppTurn).toHaveBeenCalledWith(
      'event-1',
      'session-uuid-1',
      expect.anything(),
      sampleCard.body,
      { url: sampleCard.imageUrl, caption: sampleCard.name },
      sampleCard,
    );

    // Delivers native product card
    expect(mockSendWhatsAppProductCard).toHaveBeenCalledWith('+919876543210', sampleCard);
    expect(mockMarkWhatsAppMediaSent).toHaveBeenCalledWith('event-1');

    // Does NOT send duplicate standalone image or duplicate plain text (since card body == replyText)
    expect(mockSendWhatsAppImage).not.toHaveBeenCalled();
    expect(mockSendWhatsAppMessage).not.toHaveBeenCalled();

    // Marks event processed
    expect(mockMarkWhatsAppMessageProcessed).toHaveBeenCalledWith('event-1');
  });

  it('allows failed card delivery to be retried without re-running conversational turn', async () => {
    const initialEvent: WhatsAppInboxEvent = {
      id: 'event-2',
      providerMessageId: 'wamid.2',
      phone: '+919876543210',
      messageText: '1',
      replyText: null,
      mediaUrl: null,
      mediaCaption: null,
      mediaSentAt: null,
      attemptCount: 1,
    };

    mockProcessTurn.mockResolvedValueOnce({
      state: createInitialState(),
      replyText: sampleCard.body,
      policyViolations: [],
      productCard: sampleCard,
      productImage: { url: sampleCard.imageUrl, caption: sampleCard.name },
    });

    // Delivery fails on WhatsApp API side
    mockSendWhatsAppProductCard.mockRejectedValueOnce(new Error('Network timeout'));

    await expect(processInboxEvent(initialEvent)).rejects.toThrow('Network timeout');

    // Verified state/reply was already persisted before delivery attempted
    expect(mockSaveWhatsAppTurn).toHaveBeenCalledWith(
      'event-2',
      'session-uuid-1',
      expect.anything(),
      sampleCard.body,
      { url: sampleCard.imageUrl, caption: sampleCard.name },
      sampleCard,
    );
    // Media was not marked sent, message was not marked processed
    expect(mockMarkWhatsAppMediaSent).not.toHaveBeenCalled();
    expect(mockMarkWhatsAppMessageProcessed).not.toHaveBeenCalled();

    // Now simulate retry attempt: the event is claimed with replyText already stored
    const retryEvent: WhatsAppInboxEvent = {
      id: 'event-2',
      providerMessageId: 'wamid.2',
      phone: '+919876543210',
      messageText: '1',
      replyText: sampleCard.body,
      mediaUrl: sampleCard.imageUrl,
      mediaCaption: serializeProductCard(sampleCard),
      mediaSentAt: null,
      attemptCount: 2,
    };

    mockSendWhatsAppProductCard.mockResolvedValueOnce(undefined);

    await processInboxEvent(retryEvent);

    // Crucial: processTurn is NEVER called again during delivery retry
    expect(mockProcessTurn).toHaveBeenCalledTimes(1); // from the initial attempt only

    // Retries card delivery, marks media sent, marks processed
    expect(mockSendWhatsAppProductCard).toHaveBeenCalledWith('+919876543210', sampleCard);
    expect(mockMarkWhatsAppMediaSent).toHaveBeenCalledWith('event-2');
    expect(mockSendWhatsAppMessage).not.toHaveBeenCalled();
    expect(mockMarkWhatsAppMessageProcessed).toHaveBeenCalledWith('event-2');
  });

  it('does not duplicate an already-successful card, image, or text on retry when mediaSentAt is populated', async () => {
    const retryEventWithMediaSent: WhatsAppInboxEvent = {
      id: 'event-3',
      providerMessageId: 'wamid.3',
      phone: '+919876543210',
      messageText: '1',
      replyText: sampleCard.body,
      mediaUrl: sampleCard.imageUrl,
      mediaCaption: serializeProductCard(sampleCard),
      mediaSentAt: '2026-09-08T12:00:00.000Z',
      attemptCount: 2,
    };

    await processInboxEvent(retryEventWithMediaSent);

    // No card resend
    expect(mockSendWhatsAppProductCard).not.toHaveBeenCalled();
    // No image resend
    expect(mockSendWhatsAppImage).not.toHaveBeenCalled();
    // No duplicate text resend
    expect(mockSendWhatsAppMessage).not.toHaveBeenCalled();
    // No turn re-processing
    expect(mockProcessTurn).not.toHaveBeenCalled();
    // Idempotently completes the event
    expect(mockMarkWhatsAppMessageProcessed).toHaveBeenCalledWith('event-3');
  });

  it('preserves existing standalone image fallback when product card is not present', async () => {
    const event: WhatsAppInboxEvent = {
      id: 'event-4',
      providerMessageId: 'wamid.4',
      phone: '+919876543210',
      messageText: 'Show photo',
      replyText: null,
      mediaUrl: null,
      mediaCaption: null,
      mediaSentAt: null,
      attemptCount: 1,
    };

    const standaloneFallbackReply = 'Here is the product photo for Alpha.';
    mockProcessTurn.mockResolvedValueOnce({
      state: createInitialState(),
      replyText: standaloneFallbackReply,
      policyViolations: [],
      productCard: undefined,
      productImage: { url: 'https://cdn.example.com/fallback.png', caption: 'Alpha' },
    });

    await processInboxEvent(event);

    expect(mockSaveWhatsAppTurn).toHaveBeenCalledWith(
      'event-4',
      'session-uuid-1',
      expect.anything(),
      standaloneFallbackReply,
      { url: 'https://cdn.example.com/fallback.png', caption: 'Alpha' },
      undefined,
    );

    // Product card is not sent; standalone image + text fallback is delivered
    expect(mockSendWhatsAppProductCard).not.toHaveBeenCalled();
    expect(mockSendWhatsAppImage).toHaveBeenCalledWith('+919876543210', 'https://cdn.example.com/fallback.png', 'Alpha');
    expect(mockMarkWhatsAppMediaSent).toHaveBeenCalledWith('event-4');
    expect(mockSendWhatsAppMessage).toHaveBeenCalledWith('+919876543210', standaloneFallbackReply);
    expect(mockMarkWhatsAppMessageProcessed).toHaveBeenCalledWith('event-4');
  });

  it('handles retry for standalone image delivery without duplicating sent image or text', async () => {
    // Retry when image was not yet sent
    const retryImagePending: WhatsAppInboxEvent = {
      id: 'event-5',
      providerMessageId: 'wamid.5',
      phone: '+919876543210',
      messageText: 'Show photo',
      replyText: 'Here is the product photo.',
      mediaUrl: 'https://cdn.example.com/fallback.png',
      mediaCaption: 'Alpha',
      mediaSentAt: null,
      attemptCount: 2,
    };

    await processInboxEvent(retryImagePending);
    expect(mockSendWhatsAppProductCard).not.toHaveBeenCalled();
    expect(mockSendWhatsAppImage).toHaveBeenCalledWith('+919876543210', 'https://cdn.example.com/fallback.png', 'Alpha');
    expect(mockMarkWhatsAppMediaSent).toHaveBeenCalledWith('event-5');
    expect(mockSendWhatsAppMessage).toHaveBeenCalledWith('+919876543210', 'Here is the product photo.');
    expect(mockMarkWhatsAppMessageProcessed).toHaveBeenCalledWith('event-5');

    vi.clearAllMocks();

    // Retry when mediaSentAt is already populated: does not resend image, card, or duplicate text
    const retryImageAlreadySent: WhatsAppInboxEvent = {
      id: 'event-5',
      providerMessageId: 'wamid.5',
      phone: '+919876543210',
      messageText: 'Show photo',
      replyText: 'Here is the product photo.',
      mediaUrl: 'https://cdn.example.com/fallback.png',
      mediaCaption: 'Alpha',
      mediaSentAt: '2026-09-08T12:00:00.000Z',
      attemptCount: 3,
    };

    await processInboxEvent(retryImageAlreadySent);
    expect(mockSendWhatsAppProductCard).not.toHaveBeenCalled();
    expect(mockSendWhatsAppImage).not.toHaveBeenCalled();
    expect(mockSendWhatsAppMessage).not.toHaveBeenCalled();
    expect(mockMarkWhatsAppMessageProcessed).toHaveBeenCalledWith('event-5');
  });

  it('retries text message delivery when there is no media and replyText was persisted', async () => {
    const textRetryEvent: WhatsAppInboxEvent = {
      id: 'event-6',
      providerMessageId: 'wamid.6',
      phone: '+919876543210',
      messageText: 'What are your hours?',
      replyText: 'We are open 9am to 6pm.',
      mediaUrl: null,
      mediaCaption: null,
      mediaSentAt: null,
      attemptCount: 2,
    };

    await processInboxEvent(textRetryEvent);
    expect(mockSendWhatsAppProductCard).not.toHaveBeenCalled();
    expect(mockSendWhatsAppImage).not.toHaveBeenCalled();
    expect(mockSendWhatsAppMessage).toHaveBeenCalledWith('+919876543210', 'We are open 9am to 6pm.');
    expect(mockMarkWhatsAppMessageProcessed).toHaveBeenCalledWith('event-6');
  });
});
