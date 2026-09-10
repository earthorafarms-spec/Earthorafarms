import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-admin-password",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function validHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "POST required" });

  const adminPassword = req.headers.get("x-admin-password")?.trim();
  if (!adminPassword || adminPassword.length > 512) {
    return json(401, { ok: false, error: "Admin verification required" });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const client = createClient(supabaseUrl, serviceKey);
    const { data: verification, error: verificationError } = await client.functions.invoke("verify-admin", {
      body: { password: adminPassword },
    });
    if (verificationError || verification?.ok !== true) {
      return json(403, { ok: false, error: "Admin verification failed" });
    }

    const body = await req.json() as { orderId?: unknown; trackingUrl?: unknown };
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const trackingUrl = typeof body.trackingUrl === "string" ? body.trackingUrl.trim() : "";
    if (!orderId || orderId.length > 255 || !validHttpUrl(trackingUrl)) {
      return json(400, { ok: false, error: "A valid order ID and HTTP(S) tracking URL are required" });
    }

    const { data: order, error: orderError } = await client
      .from("orders")
      .select("id,order_number,customer_phone,shipping_address,tracking_url")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) return json(404, { ok: false, error: "Order not found" });

    const shipping = order.shipping_address && typeof order.shipping_address === "object"
      ? order.shipping_address as Record<string, unknown>
      : {};
    const phone = String(order.customer_phone || shipping.phone || "").trim();
    if (!phone) return json(422, { ok: false, error: "This order has no WhatsApp phone number" });

    const { error: saveError } = await client.from("orders").update({
      tracking_url: trackingUrl,
      tracking_sent_at: null,
    }).eq("id", orderId);
    if (saveError) throw saveError;

    const whatsappUrl = Deno.env.get("WHATSAPP_SERVICE_URL")?.replace(/\/$/, "");
    const whatsappKey = Deno.env.get("WHATSAPP_INTERNAL_KEY");
    if (!whatsappUrl || !whatsappKey) {
      return json(503, { ok: false, error: "WhatsApp tracking delivery is not configured" });
    }

    const delivery = await fetch(`${whatsappUrl}/whatsapp/admin/tracking`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-whatsapp-internal-key": whatsappKey },
      body: JSON.stringify({
        phone,
        orderNumber: order.order_number || order.id,
        trackingUrl,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!delivery.ok) {
      console.error("[send-order-tracking] WhatsApp service rejected delivery", delivery.status);
      return json(502, { ok: false, error: "Tracking link was saved, but WhatsApp delivery failed" });
    }

    const sentAt = new Date().toISOString();
    const { error: markError } = await client.from("orders").update({ tracking_sent_at: sentAt }).eq("id", orderId);
    if (markError) throw markError;
    return json(200, { ok: true, trackingSentAt: sentAt });
  } catch (error) {
    console.error("[send-order-tracking] failed", error instanceof Error ? error.message : "unknown error");
    return json(500, { ok: false, error: "Could not send the tracking update" });
  }
});
