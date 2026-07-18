import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-password, x-codex-password",
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const otp: string | undefined = body?.otp;
    const domain: string | undefined = body?.domain;

    if (!otp || typeof otp !== "string" || otp.length !== 6) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid OTP format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!domain || !["admin", "codex"].includes(domain)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid domain" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("otp_codes")
      .select("id")
      .eq("otp", otp)
      .eq("domain", domain)
      .eq("used", false)
      .gte("expires_at", now)
      .limit(1);

    if (error) {
      console.error("[verify-otp] DB error:", error);
      return new Response(
        JSON.stringify({ ok: false, error: "Verification failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!data || data.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid or expired OTP" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await supabase
      .from("otp_codes")
      .update({ used: true })
      .eq("id", data[0].id);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid request" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
