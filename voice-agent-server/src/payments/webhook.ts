import { createHmac, timingSafeEqual } from "crypto";
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export function registerRazorpayWebhook(server: FastifyInstance): void {
  server.post("/webhooks/razorpay", async (request: FastifyRequest, reply: FastifyReply) => {
    const signature = request.headers["x-razorpay-signature"] as string;
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "";

    const rawBody = JSON.stringify(request.body || {});

    // Verify HMAC-SHA256 signature if secret is configured
    if (webhookSecret && signature) {
      try {
        const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
        const expectedBuf = Buffer.from(expected, "hex");
        const receivedBuf = Buffer.from(signature, "hex");

        const isValid =
          expectedBuf.length === receivedBuf.length &&
          timingSafeEqual(expectedBuf, receivedBuf);

        if (!isValid) {
          server.log.warn({ signature }, "Razorpay webhook signature mismatch");
          return reply.status(400).send({ error: "Invalid signature" });
        }
      } catch (err: any) {
        server.log.error({ err: err.message }, "Error verifying Razorpay webhook signature");
        return reply.status(400).send({ error: "Signature verification failed" });
      }
    }

    // 1. Immediately return HTTP 200 to Razorpay within 5 seconds
    reply.status(200).send({ status: "received" });

    // 2. Perform DB operations asynchronously
    const body = request.body as any || {};
    const event = body.event;
    const payload = body.payload || {};
    const paymentLink = payload.payment_link?.entity;

    if (!paymentLink) return;

    const paymentLinkId = paymentLink.id;

    try {
      if (event === "payment_link.paid") {
        server.log.info({ paymentLinkId }, "💳 [Razorpay Webhook] Payment link PAID");

        // Update voice_orders table
        const { data: vOrders } = await supabase
          .from("voice_orders")
          .update({
            payment_status: "paid",
            paid_at: new Date().toISOString(),
          })
          .eq("payment_link_id", paymentLinkId)
          .select("order_id");

        const orderId = vOrders?.[0]?.order_id;
        if (orderId) {
          // Insert into Order_history with order_status = 'processing'
          // Trigger sync_order_status_trigger will automatically sync this to orders.status
          await supabase.from("Order_history").insert({
            order_id: orderId,
            order_status: "processing",
            order_notes: "Payment captured via Razorpay Payment Link webhook",
          });
        }
      } else if (event === "payment_link.expired") {
        server.log.info({ paymentLinkId }, "⏰ [Razorpay Webhook] Payment link EXPIRED");
        await supabase
          .from("voice_orders")
          .update({ payment_status: "expired" })
          .eq("payment_link_id", paymentLinkId);
      } else if (event === "payment_link.cancelled") {
        server.log.info({ paymentLinkId }, "❌ [Razorpay Webhook] Payment link CANCELLED");
        await supabase
          .from("voice_orders")
          .update({ payment_status: "cancelled" })
          .eq("payment_link_id", paymentLinkId);
      }
    } catch (dbErr: any) {
      server.log.error({ dbErr: dbErr.message }, "Async DB update failed for Razorpay webhook");
    }
  });
}
