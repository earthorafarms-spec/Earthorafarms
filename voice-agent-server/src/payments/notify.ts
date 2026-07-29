// Note: Meta WhatsApp Cloud API requires a verified Meta Business account and approved message template.
// This is a separate approval process — if not yet approved, SMS alone works fine and WhatsApp can be enabled later without code changes.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function sendPaymentLink(
  phone: string,
  linkUrl: string,
  amount: number,
  orderId: string
): Promise<{ smsSent: boolean; whatsappSent: boolean; sentVia: "sms" | "whatsapp" | "both" | "none" }> {
  let smsSent = false;
  let whatsappSent = false;

  const normalizedPhone = phone.startsWith("+") ? phone : `+91${phone.replace(/[\s-]/g, "")}`;
  const messageText = `Earthora Farms: Pay ₹${amount} for your order #${orderId} here: ${linkUrl} — link expires in 24 hours. Reply STOP to unsubscribe.`;

  // 1. SMS Path (Tata SmartFlow SMS API)
  const smartFlowApiKey = process.env.SMARTFLOW_API_KEY;
  const smartFlowSenderId = process.env.SMARTFLOW_SENDER_ID;
  const smartFlowBaseUrl = process.env.SMARTFLOW_BASE_URL || "https://smartflow.tatacommunications.com/api/v1";

  if (smartFlowApiKey && smartFlowSenderId) {
    try {
      const smsRes = await fetch(`${smartFlowBaseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${smartFlowApiKey}`,
        },
        body: JSON.stringify({
          from: smartFlowSenderId,
          to: normalizedPhone,
          message: messageText,
          type: "text",
        }),
      });

      if (smsRes.ok) {
        smsSent = true;
        console.log(`📱 [SMS Sent] Payment link sent to ${normalizedPhone}`);
      } else {
        console.warn(`⚠️ [SMS Failed] HTTP ${smsRes.status}:`, await smsRes.text());
      }
    } catch (smsErr: any) {
      console.error(`❌ [SMS Error]:`, smsErr.message);
    }
  } else {
    console.warn("⚠️ [SMS Warning] SMARTFLOW_API_KEY or SMARTFLOW_SENDER_ID not set. Skipping SMS.");
  }

  // 2. WhatsApp Path (Tata WhatsApp API or Meta WhatsApp Cloud API)
  const tataWhatsappKey = process.env.TATA_WHATSAPP_API_KEY;
  const metaWhatsappToken = process.env.META_WHATSAPP_TOKEN;
  const metaPhoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;

  if (tataWhatsappKey) {
    try {
      const waRes = await fetch(`${smartFlowBaseUrl}/whatsapp/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tataWhatsappKey}`,
        },
        body: JSON.stringify({
          to: normalizedPhone,
          type: "text",
          text: { body: messageText },
        }),
      });
      if (waRes.ok) {
        whatsappSent = true;
        console.log(`💬 [Tata WhatsApp Sent] Payment link sent to ${normalizedPhone}`);
      }
    } catch (waErr: any) {
      console.error(`❌ [Tata WhatsApp Error]:`, waErr.message);
    }
  } else if (metaWhatsappToken && metaPhoneId) {
    try {
      const waRes = await fetch(`https://graph.facebook.com/v18.0/${metaPhoneId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${metaWhatsappToken}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: normalizedPhone.replace("+", ""),
          type: "text",
          text: { body: messageText },
        }),
      });
      if (waRes.ok) {
        whatsappSent = true;
        console.log(`💬 [Meta WhatsApp Sent] Payment link sent to ${normalizedPhone}`);
      }
    } catch (waErr: any) {
      console.error(`❌ [Meta WhatsApp Error]:`, waErr.message);
    }
  } else {
    console.warn("⚠️ WhatsApp not configured — SMS only");
  }

  const sentVia = smsSent && whatsappSent ? "both" : smsSent ? "sms" : whatsappSent ? "whatsapp" : "none";

  // Update voice_orders.sent_via in DB
  try {
    await supabase
      .from("voice_orders")
      .update({ sent_via: sentVia })
      .eq("order_id", orderId);
  } catch (dbErr: any) {
    console.error("⚠️ [voice_orders update sent_via error]:", dbErr.message);
  }

  return { smsSent, whatsappSent, sentVia };
}
