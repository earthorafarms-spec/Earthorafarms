import type { FastifyInstance, FastifyRequest } from 'fastify';
import { verifyRazorpayWebhookSignature, isPaymentSuccessEvent, extractIdempotencyKey } from '../payments/webhook.js';
import { finalizeOrderFromWebhook } from '../payments/finalizer.js';
import { recordWebhookEvent, markWebhookEventProcessed, markWebhookEventFailed } from '../repositories/webhookEvents.repository.js';
import type { RazorpayPaymentLinkWebhookPayload } from '../payments/webhook.js';

/**
 * Registered in its own encapsulated Fastify context so the raw-body
 * content-type parser applies ONLY to this route, not globally — every
 * other route keeps normal automatic JSON parsing.
 */
export async function registerPaymentWebhookRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req: FastifyRequest, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => {
        // Preserve the exact raw bytes — signature verification MUST happen
        // over the untouched body, before any JSON.parse.
        done(null, body);
      }
    );

    scoped.post('/payments/webhook', async (req, reply) => {
      const rawBody = req.body as Buffer;
      const signatureHeader = req.headers['x-razorpay-signature'] as string | undefined;
      const signatureValid = verifyRazorpayWebhookSignature(rawBody, signatureHeader);

      let payload: RazorpayPaymentLinkWebhookPayload;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        // Can't even parse it — nothing to record meaningfully, reject outright.
        return reply.status(400).send({ error: 'invalid_json' });
      }

      const idempotencyKey = extractIdempotencyKey(rawBody, payload);

      const { id: eventRowId, duplicate } = await recordWebhookEvent({
        providerEventId: idempotencyKey,
        eventType: payload.event,
        signatureValid,
        payload,
      });

      // Always 200 quickly — Razorpay retries on non-2xx, and slow/failing
      // responses are exactly how duplicate deliveries happen in the first
      // place. Duplicates and invalid signatures are logged, not retried.
      if (duplicate) {
        return reply.status(200).send({ ok: true, duplicate: true });
      }

      if (!signatureValid) {
        req.log.warn({ eventType: payload.event }, 'Razorpay webhook signature verification failed');
        return reply.status(200).send({ ok: true, signatureValid: false });
      }

      if (!isPaymentSuccessEvent(payload.event)) {
        await markWebhookEventProcessed(eventRowId);
        return reply.status(200).send({ ok: true, ignored: true });
      }

      const paymentLinkId = payload.payload?.payment_link?.entity?.id;
      const paymentEntity = payload.payload?.payment?.entity;

      if (!paymentLinkId || !paymentEntity?.id || !paymentEntity.amount || !paymentEntity.currency) {
        await markWebhookEventFailed(eventRowId, 'Missing payment_link or payment entity fields');
        return reply.status(200).send({ ok: true, error: 'malformed_payload' });
      }

      try {
        const result = await finalizeOrderFromWebhook({
          paymentLinkId,
          razorpayPaymentId: paymentEntity.id,
          paidAmount: paymentEntity.amount / 100, // paise -> rupees
          paidCurrency: paymentEntity.currency,
        });
        await markWebhookEventProcessed(eventRowId);
        req.log.info({ orderId: result.orderId }, 'voice order finalized');
        return reply.status(200).send({ ok: true, orderId: result.orderId });
      } catch (err) {
        await markWebhookEventFailed(eventRowId, (err as Error).message);
        req.log.error(err, 'voice order finalization failed');
        // Still 200: the event is durably recorded as failed for manual/automated
        // retry from the payment_webhook_events inbox, not for Razorpay to retry
        // (retrying won't fix a code/data bug, and could otherwise fire an
        // unbounded number of duplicate finalize attempts).
        return reply.status(200).send({ ok: true, error: 'finalization_failed' });
      }
    });
  });
}
