import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-password",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { name, email, phone, topic, message } = (await req.json()) as {
      name?: string;
      email?: string;
      phone?: string;
      topic?: string;
      message?: string;
    };

    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing required fields: name, email, and message are required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.warn("[send-contact-email] RESEND_API_KEY secret is not configured in Supabase secrets.");
      return new Response(
        JSON.stringify({ ok: true, warning: "RESEND_API_KEY secret not configured in Supabase secrets." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const inquiryTopic = topic || "General Inquiry";
    const visitorPhone = phone || "Not provided";

    // 1. Email to the Business (contactus@earthorafarms.com)
    const businessEmailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; background: #FAF9F5; border-radius: 20px; border: 1px solid #e2e0d8;">
        <div style="background: #1b4332; padding: 20px; border-radius: 14px; margin-bottom: 24px; text-align: center;">
          <h2 style="color: #ffffff; margin: 0; font-size: 20px; letter-spacing: -0.5px;">🌿 Earthora Farms — New Contact Submission</h2>
        </div>

        <div style="background: #ffffff; border-radius: 14px; padding: 20px; border: 1px solid #e8e6df; margin-bottom: 16px;">
          <p style="margin: 0 0 10px; font-size: 14px; color: #222;"><strong>Customer Name:</strong> ${name}</p>
          <p style="margin: 0 0 10px; font-size: 14px; color: #222;"><strong>Email Address:</strong> <a href="mailto:${email}" style="color: #1b4332;">${email}</a></p>
          <p style="margin: 0 0 10px; font-size: 14px; color: #222;"><strong>Phone Number:</strong> ${visitorPhone}</p>
          <p style="margin: 0; font-size: 14px; color: #222;"><strong>Topic / Subject:</strong> ${inquiryTopic}</p>
        </div>

        <div style="background: #ffffff; border-radius: 14px; padding: 24px; border: 1px solid #e8e6df;">
          <p style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #888; font-weight: bold;">Message Content</p>
          <p style="margin: 0; font-size: 14px; color: #333; line-height: 1.6; white-space: pre-wrap;">${message}</p>
        </div>

        <p style="text-align: center; font-size: 11px; color: #999; margin-top: 24px;">Sent automatically via Earthora Farms Supabase Edge Function</p>
      </div>
    `;

    const resendBusiness = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Earthora Farms Contact <contactus@earthorafarms.com>",
        to: ["contactus@earthorafarms.com"],
        subject: `New Contact Form Submission – ${inquiryTopic}`,
        html: businessEmailHtml,
      }),
    });

    if (!resendBusiness.ok) {
      const errText = await resendBusiness.text();
      console.error("[send-contact-email] Error sending business notification:", errText);
      return new Response(
        JSON.stringify({ ok: true, warning: `Recorded in DB. Email provider notice: ${errText}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Email Confirmation to the Visitor
    const visitorEmailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; background: #FAF9F5; border-radius: 20px; border: 1px solid #e2e0d8;">
        <div style="background: #1b4332; padding: 24px; border-radius: 14px; margin-bottom: 24px; text-align: center;">
          <h2 style="color: #ffffff; margin: 0 0 8px; font-size: 22px; letter-spacing: -0.5px;">🌿 Thank You for Reaching Out!</h2>
          <p style="color: #e2e0d8; margin: 0; font-size: 14px;">Earthora Farms Customer Support</p>
        </div>

        <div style="background: #ffffff; border-radius: 14px; padding: 24px; border: 1px solid #e8e6df; margin-bottom: 20px;">
          <p style="margin: 0 0 12px; font-size: 15px; color: #222;">Hi <strong>${name}</strong>,</p>
          <p style="margin: 0 0 12px; font-size: 14px; color: #444; line-height: 1.6;">
            We received your message regarding <strong>${inquiryTopic}</strong>. Our farm support team will review your inquiry and get back to you within <strong>24 hours</strong>.
          </p>
        </div>

        <div style="background: #ffffff; border-radius: 14px; padding: 20px; border: 1px solid #e8e6df; margin-bottom: 24px;">
          <p style="margin: 0 0 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #888; font-weight: bold;">Summary of Your Message</p>
          <p style="margin: 0 0 6px; font-size: 13px; color: #555;"><strong>Topic:</strong> ${inquiryTopic}</p>
          <p style="margin: 0 0 6px; font-size: 13px; color: #555;"><strong>Phone:</strong> ${visitorPhone}</p>
          <div style="margin-top: 10px; padding: 12px; background: #fafaf8; border-radius: 8px; font-size: 13px; color: #444; line-height: 1.5; white-space: pre-wrap;">${message}</div>
        </div>

        <p style="text-align: center; font-size: 12px; color: #777; margin: 0;">
          Warm regards,<br />
          <strong>The Earthora Farms Team</strong><br />
          <a href="https://earthorafarms.com" style="color: #1b4332; text-decoration: none;">earthorafarms.com</a>
        </p>
      </div>
    `;

    const resendVisitor = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Earthora Farms <support@earthorafarms.com>",
        to: [email],
        subject: "We received your message – Earthora Farms",
        html: visitorEmailHtml,
      }),
    });

    if (!resendVisitor.ok) {
      const visitorErrText = await resendVisitor.text();
      console.warn("[send-contact-email] Warning sending visitor confirmation email:", visitorErrText);
      // We still return ok: true since business notification succeeded
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[send-contact-email] Exception:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err.message || "An unexpected error occurred." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
