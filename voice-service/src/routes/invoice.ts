import type { FastifyInstance } from 'fastify';
import { findCheckoutSessionByPaymentLinkId } from '../repositories/checkoutSessions.repository.js';
import { fetchInvoicePdf, verifyInvoiceReference } from '../payments/invoice-document.js';

export async function registerInvoiceRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { paymentLinkId: string }; Querystring: { signature?: string } }>(
    '/payments/invoice/:paymentLinkId',
    async (req, reply) => {
      const { paymentLinkId } = req.params;
      if (!verifyInvoiceReference(paymentLinkId, req.query.signature)) {
        return reply.status(404).send({ error: 'invoice_not_found' });
      }

      const session = await findCheckoutSessionByPaymentLinkId(paymentLinkId);
      if (!session || session.status !== 'order_created' || !session.orderId) {
        return reply.status(404).send({ error: 'invoice_not_ready' });
      }

      try {
        const pdf = await fetchInvoicePdf(session.orderId, session.language);
        const orderNumber = session.orderId;
        return reply
          .header('Cache-Control', 'private, no-store')
          .header('Content-Disposition', `inline; filename="Tax_Invoice_${orderNumber}.pdf"`)
          .type('application/pdf')
          .send(pdf);
      } catch (error) {
        req.log.error({ err: error, orderId: session.orderId }, 'invoice PDF retrieval failed');
        return reply.status(502).send({ error: 'invoice_unavailable' });
      }
    },
  );
}
