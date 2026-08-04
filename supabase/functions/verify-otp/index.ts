import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-password",
};

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

async function checkRateLimit(
  supabase: ReturnType<typeof createClient>,
  ip: string,
  action: string,
  maxAttempts = 5,
  windowMinutes = 15,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("rate_limit_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip_address", ip)
    .eq("action", action)
    .gte("attempted_at", since);
  return (count ?? 0) < maxAttempts;
}

async function recordAttempt(
  supabase: ReturnType<typeof createClient>,
  ip: string,
  action: string,
): Promise<void> {
  await supabase.from("rate_limit_attempts").insert({
    ip_address: ip,
    action,
    attempted_at: new Date().toISOString(),
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const otp: string | undefined = body?.otp;
    const domain = "admin";

    if (!otp || typeof otp !== "string" || otp.length !== 6) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid OTP format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const clientIp = getClientIp(req);
    if (!await checkRateLimit(supabase, clientIp, `verify-otp:${domain}`)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Too many attempts. Try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
      await recordAttempt(supabase, clientIp, `verify-otp:${domain}`);
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
