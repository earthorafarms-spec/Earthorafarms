import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export interface CreatePaymentLinkParams {
  orderId: string;
  amount: number; // In Rupees
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
}

export interface PaymentLinkResult {
  paymentLinkUrl: string;
  paymentLinkId: string;
}

export async function createPaymentLink(params: CreatePaymentLinkParams): Promise<PaymentLinkResult> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const websiteUrl = (process.env.WEBSITE_URL || "https://earthorafarms.com").replace(/\/$/, "");

  if (!keyId || !keySecret) {
    throw new Error("RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is not configured");
  }

  const amountInPaise = Math.round(params.amount * 100);
  const authHeader = "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  const payload = {
    amount: amountInPaise,
    currency: "INR",
    accept_partial: false,
    description: `Earthora Farms Order #${params.orderId}`,
    customer: {
      name: params.customerName || "Valued Customer",
      contact: params.customerPhone ? (params.customerPhone.startsWith("+") ? params.customerPhone : `+91${params.customerPhone}`) : undefined,
      email: params.customerEmail || undefined,
    },
    notify: {
      sms: true,
      whatsapp: true,
    },
    reminder_enable: true,
    callback_url: `${websiteUrl}/order-confirmation?order=${params.orderId}`,
    callback_method: "get",
  };

  const res = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Razorpay Payment Link API failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const paymentLinkUrl = data.short_url || data.url;
  const paymentLinkId = data.id;

  // Record in voice_orders table
  try {
    await supabase.from("voice_orders").insert({
      order_id: params.orderId,
      payment_link_url: paymentLinkUrl,
      payment_link_id: paymentLinkId,
      payment_status: "pending_payment",
      customer_phone: params.customerPhone || null,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch (dbErr: any) {
    console.error("⚠️ [voice_orders DB Error]:", dbErr.message);
  }

  return { paymentLinkUrl, paymentLinkId };
}
