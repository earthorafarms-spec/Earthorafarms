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
import { processTurn } from '../voice-service/src/conversation/controller.js';
import { sendWhatsAppImage, sendWhatsAppMessage, sendWhatsAppProductCard, WhatsAppDeliveryError } from './provider.js';
import { recordWhatsAppDiagnostic } from './diagnostics.js';
import { parsePersistedProductCard } from './product-card.js';
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
    const productCard = parsePersistedProductCard(event.mediaCaption);
    if (productCard) {
      if (!event.mediaSentAt) {
        await sendWhatsAppProductCard(event.phone, productCard);
        await markWhatsAppMediaSent(event.id);
      }
      if (!event.mediaSentAt && event.replyText !== productCard.body) {
        await sendWhatsAppMessage(event.phone, event.replyText);
      }
    } else {
      if (event.mediaUrl && !event.mediaSentAt) {
        await sendWhatsAppImage(event.phone, event.mediaUrl, event.mediaCaption ?? undefined);
        await markWhatsAppMediaSent(event.id);
      }
      if (!event.mediaSentAt) {
        await sendWhatsAppMessage(event.phone, event.replyText);
      }
    }
    await markWhatsAppMessageProcessed(event.id);
    return;
  }

  const { voiceSessionId, state } = await getOrCreateSession(event.phone);
  if (!state.checkoutFields) state.checkoutFields = {};
  if (!state.checkoutFields.phone) state.checkoutFields.phone = event.phone;

  const input = event.messageText ??
    'The customer sent an unsupported WhatsApp attachment. Ask them to type their question or order.';
  const outcome = await processTurn(voiceSessionId, state, input, 'text');

  // Persist conversation/cart state and the exact outbound reply atomically.
  // If delivery fails, the next attempt resends replyText without reprocessing.
  await saveWhatsAppTurn(
    event.id,
    voiceSessionId,
    outcome.state,
    outcome.replyText,
    outcome.productImage,
    outcome.productCard,
  );
  if (outcome.productCard) {
    await sendWhatsAppProductCard(event.phone, outcome.productCard);
    await markWhatsAppMediaSent(event.id);
  } else if (outcome.productImage) {
    await sendWhatsAppImage(event.phone, outcome.productImage.url, outcome.productImage.caption);
    await markWhatsAppMediaSent(event.id);
  }
  if (!outcome.productCard || outcome.replyText !== outcome.productCard.body) {
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
            ...(err instanceof WhatsAppDeliveryError ? { providerStatus: err.status } : {}),
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
