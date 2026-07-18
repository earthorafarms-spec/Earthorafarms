// Manual dashboard step:
// 1. In Supabase Dashboard, go to Database -> Webhooks -> Create Webhook.
// 2. Name: "send-restock-alert", Table: "restock_notifications", Event: "INSERT".
// 3. Action: "Call Edge Function", select "send-restock-alert".
// 4. Ensure you set the RESEND_API_KEY environment secret for this Edge Function.

// Minimal Deno namespace declaration so VS Code doesn't flag `Deno.env`
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

// satisfy local compiler for URL import
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();
    const record = payload.record; // the new restock_notifications row

    if (!record || !record.email || !record.message) {
      return new Response("Missing email or message fields", { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Send transaction email via Resend API
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Earthora Farms <alerts@earthorafarms.com>",
        to: [record.email],
        subject: "Product Restock Alert! 🌱",
        html: `<div style="font-family: sans-serif; padding: 20px; line-height: 1.6; color: #333;">
                 <h2>Product Back In Stock!</h2>
                 <p>${record.message}</p>
                 <p>Visit <a href="https://earthorafarms.com/our-product">Earthora Farms</a> to place your order now.</p>
               </div>`,
      }),
    });

    const isOk = response.ok;
    
    // Update the notification row with status
    await supabase
      .from("restock_notifications")
      .update({
        status: isOk ? "delivered" : "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", record.id);

    if (!isOk) {
      const errText = await response.text();
      throw new Error(`Resend API failed: ${errText}`);
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });

  } catch (err: any) {
    console.error("Restock email alert error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
