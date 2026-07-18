import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-password, x-codex-password",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { name, email, subject, message } = await req.json();

    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: name, email, and message are required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.warn("RESEND_API_KEY secret is not set.");
      return new Response(
        JSON.stringify({ error: "Email provider not configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Earthora Contact Form <contact@earthorafarms.com>",
        to: ["query@earthorafarms.com", "earthorafarms@gmail.com"],
        subject: `[Contact Form] ${subject || "New Inquiry from " + name}`,
        html: `
          <div style="font-family:sans-serif;max-width:550px;margin:0 auto;padding:32px 24px;background:#fafaf8;border-radius:16px;border:1px solid #eee;">
            <h2 style="color:#1b4332;margin:0 0 16px;font-size:20px;">New Contact Submission</h2>
            
            <div style="background:#fff;border-radius:12px;padding:20px;border:1px solid #eee;margin-bottom:16px;">
              <p style="margin:0 0 10px;font-size:14px;color:#333;"><strong>From:</strong> ${name} (&lt;${email}&gt;)</p>
              <p style="margin:0 0 10px;font-size:14px;color:#333;"><strong>Subject:</strong> ${subject || "No Subject"}</p>
            </div>
            
            <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #eee;">
              <p style="margin:0;font-size:14px;color:#555;line-height:1.6;white-space:pre-wrap;">${message}</p>
            </div>
          </div>
        `,
      }),
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      console.error("Resend API error:", errorText);
      return new Response(
        JSON.stringify({ error: "Failed to send email via provider." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Internal Server Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "An unexpected error occurred." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
