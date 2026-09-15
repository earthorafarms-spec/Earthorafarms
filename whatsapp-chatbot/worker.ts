import type { FastifyInstance } from '../voice-service/src/host-types.js';
import { createHash } from 'node:crypto';
import { getOrCreateSession } from './sessions.repository.js';
import {
  claimNextWhatsAppMessage,
  claimExpiredWhatsAppFlowTimeout,
  markWhatsAppMessageFailed,
  markWhatsAppMessageProcessed,
  markWhatsAppMediaSent,
  saveWhatsAppTurn,
  type WhatsAppInboxEvent,
} from './events.repository.js';
import { processWhatsAppTurn } from './conversation/controller.js';
import { sendWhatsAppImage, sendWhatsAppMessage, sendWhatsAppProductCard, WhatsAppDeliveryError } from './provider.js';
import { recordWhatsAppDiagnostic } from './diagnostics.js';
import { parsePersistedProductCard, parsePersistedProductCards } from './product-card.js';
import { drainLowStockAlerts } from './low-stock.js';

const POLL_INTERVAL_MS = 750;
const MAX_EVENTS_PER_DRAIN = 10;
const LOW_STOCK_POLL_INTERVAL_MS = 15_000;
let wakeWorker: (() => void) | null = null;

function phoneReference(phone: string): string {
  return createHash('sha256').update(phone).digest('hex').slice(0, 12);
}

export async function processInboxEvent(event: WhatsAppInboxEvent): Promise<void> {
  // A reply already stored means the state transition committed previously;
  // retry delivery only, never run the user's turn or cart mutation twice.
  if (event.replyText) {
    const productCards = parsePersistedProductCards(event.mediaCaption);
    if (productCards && productCards.length > 0) {
      if (!event.mediaSentAt) {
        for (const card of productCards) {
          await sendWhatsAppProductCard(event.phone, card);
        }
        await markWhatsAppMediaSent(event.id);
      }
      const allBodies = productCards.map((c) => c.body).join('\n\n');
      if (event.replyText !== allBodies && !productCards.some((c) => c.body === event.replyText)) {
        await sendWhatsAppMessage(event.phone, event.replyText);
      }
    } else {
      if (event.mediaUrl && !event.mediaSentAt) {
        await sendWhatsAppImage(event.phone, event.mediaUrl, event.mediaCaption ?? undefined);
        await markWhatsAppMediaSent(event.id);
      }
      await sendWhatsAppMessage(event.phone, event.replyText);
    }
    await markWhatsAppMessageProcessed(event.id);
    return;
  }

  const { voiceSessionId, state } = await getOrCreateSession(event.phone);
  if (!state.checkoutFields) state.checkoutFields = {};
  if (!state.checkoutFields.phone) state.checkoutFields.phone = event.phone;

  const input = event.messageText ??
    'The customer sent an unsupported WhatsApp attachment. Ask them to type their question or order.';
  const outcome = await processWhatsAppTurn(voiceSessionId, state, input);

  // Persist conversation/cart state and the exact outbound reply atomically.
  // If delivery fails, the next attempt resends replyText without reprocessing.
  if (outcome.productCards && outcome.productCards.length > 0) {
    await saveWhatsAppTurn(
      event.id,
      voiceSessionId,
      outcome.state,
      outcome.replyText,
      outcome.productImage,
      outcome.productCard,
      outcome.productCards,
    );
  } else {
    await saveWhatsAppTurn(
      event.id,
      voiceSessionId,
      outcome.state,
      outcome.replyText,
      outcome.productImage,
      outcome.productCard,
    );
  }

  const cards = outcome.productCards && outcome.productCards.length > 0
    ? outcome.productCards
    : (outcome.productCard ? [outcome.productCard] : null);

  if (cards && cards.length > 0) {
    for (const card of cards) {
      await sendWhatsAppProductCard(event.phone, card);
    }
    await markWhatsAppMediaSent(event.id);
  } else if (outcome.productImage) {
    await sendWhatsAppImage(event.phone, outcome.productImage.url, outcome.productImage.caption);
    await markWhatsAppMediaSent(event.id);
  }

  const allBodies = cards ? cards.map((c) => c.body).join('\n\n') : null;
  const isCardBody = cards && (
    outcome.replyText === allBodies ||
    cards.some((c) => c.body === outcome.replyText)
  );

  if (!isCardBody) {
    await sendWhatsAppMessage(event.phone, outcome.replyText);
  }
  await markWhatsAppMessageProcessed(event.id);
}

export async function drainExpiredFlowTimeouts(): Promise<number> {
  let claimedCount = 0;
  for (let count = 0; count < MAX_EVENTS_PER_DRAIN; count++) {
    const claimed = await claimExpiredWhatsAppFlowTimeout();
    if (!claimed) break;
    claimedCount++;
    try {
      await sendWhatsAppMessage(claimed.phoneNumber, claimed.replyText);
      await markWhatsAppMessageProcessed(claimed.eventId);
    } catch (err) {
      const message = (err as Error).message || 'WhatsApp timeout delivery error';
      await markWhatsAppMessageFailed(claimed.eventId, message, 1).catch(() => {});
    }
  }
  return claimedCount;
}

export function startWhatsAppWorker(app: FastifyInstance): void {
  let running = false;
  let stopped = false;

  const drain = async () => {
    if (running || stopped) return;
    running = true;
    try {
      for (let count = 0; count < MAX_EVENTS_PER_DRAIN; count++) {
        const event = await claimNextWhatsAppMessage();
        if (!event) break;
        try {
          recordWhatsAppDiagnostic('processing', { attempt: event.attemptCount });
          await processInboxEvent(event);
          recordWhatsAppDiagnostic('reply_sent', { attempt: event.attemptCount });
          app.log.info({ messageId: event.providerMessageId, contact: phoneReference(event.phone) }, 'WhatsApp message processed');
        } catch (err) {
          const message = (err as Error).message || 'unknown WhatsApp processing error';
          recordWhatsAppDiagnostic('worker_failed', {
            attempt: event.attemptCount,
            failureType: err instanceof Error ? err.name : typeof err,
            ...(err instanceof WhatsAppDeliveryError ? {
              providerStatus: err.status,
              ...(err.responseBody ? { providerResponse: err.responseBody.slice(0, 500) } : {}),
            } : {}),
          });
          app.log.error({ err: message, messageId: event.providerMessageId, contact: phoneReference(event.phone) }, 'WhatsApp message processing failed');
          await markWhatsAppMessageFailed(event.id, message, event.attemptCount).catch((markErr) => {
            app.log.error(markErr, 'failed to persist WhatsApp inbox error');
          });
        }
      }
      await drainExpiredFlowTimeouts();
    } catch (err) {
      app.log.error(err, 'WhatsApp inbox drain failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => { void drain(); }, POLL_INTERVAL_MS);
  const lowStockTimer = setInterval(() => {
    void drainLowStockAlerts(app.log).catch((err) => app.log.error(err, 'low-stock alert drain failed'));
  }, LOW_STOCK_POLL_INTERVAL_MS);
  timer.unref();
  lowStockTimer.unref();
  wakeWorker = () => { void drain(); };
  void drain();
  void drainLowStockAlerts(app.log).catch((err) => app.log.error(err, 'low-stock alert drain failed'));

  app.addHook('onClose', async () => {
    stopped = true;
    clearInterval(timer);
    clearInterval(lowStockTimer);
    wakeWorker = null;
  });
}

export function wakeWhatsAppWorker(): void {
  wakeWorker?.();
}
