// Deno Edge Function — runs on Supabase's Deno runtime, not Node.js.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://earthorafarms.com",
  "https://www.earthorafarms.com",
  "http://localhost:5173",
  "http://localhost:3000",
];

function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-password",
    "Vary": "Origin",
  };
}

function getClientIp(req: Request): string {
  // CF-Connecting-IP is set by Cloudflare and cannot be spoofed by request sender
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let mismatch = ab.length !== bb.length ? 1 : 0;
  const len = Math.max(ab.length, bb.length);
  const aPadded = new Uint8Array(len);
  const bPadded = new Uint8Array(len);
  aPadded.set(ab);
  bPadded.set(bb);
  for (let i = 0; i < len; i++) {
    mismatch |= aPadded[i] ^ bPadded[i];
  }
  return mismatch === 0;
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
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const password: string | undefined = body?.password;

    if (!password || typeof password !== "string") {
      return new Response(
        JSON.stringify({ ok: false, error: "No password provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const clientIp = getClientIp(req);
    if (!await checkRateLimit(supabase, clientIp, "verify-admin")) {
      return new Response(
        JSON.stringify({ ok: false, error: "Too many attempts. Try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Check environment variable first
    const envPassword = Deno.env.get("ADMIN_PASSWORD");
    if (envPassword) {
      const ok = constantTimeEqual(password, envPassword);
      if (!ok) await recordAttempt(supabase, clientIp, "verify-admin");
      return new Response(JSON.stringify({ ok }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fall back to admin_settings table
    const { data, error } = await supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "admin_password")
      .single();

    if (error || !data) {
      return new Response(
        JSON.stringify({ ok: false, error: "Server misconfiguration" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ok = constantTimeEqual(password, data.value);
    if (!ok) await recordAttempt(supabase, clientIp, "verify-admin");

    return new Response(JSON.stringify({ ok }), {
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
