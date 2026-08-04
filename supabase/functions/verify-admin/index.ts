// Deno Edge Function — runs on Supabase's Deno runtime, not Node.js.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-password",
};

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

Deno.serve(async (req: Request): Promise<Response> => {
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

    // 1. Check environment variable first
    const envPassword = Deno.env.get("ADMIN_PASSWORD");
    if (envPassword) {
      const ok = constantTimeEqual(password, envPassword);
      return new Response(JSON.stringify({ ok }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fall back to admin_settings table (set via the Settings page)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "admin_password")
      .single();

    if (error || !data) {
      console.error("ADMIN_PASSWORD env var is not set and no DB row found");
      return new Response(
        JSON.stringify({ ok: false, error: "Server misconfiguration" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ok = constantTimeEqual(password, data.value);

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
