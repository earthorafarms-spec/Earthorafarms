// Deno Edge Function — updates the admin portal password in the DB.
// The verify-admin function reads from the same table as a fallback.

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
    "authorization, x-client-info, apikey, content-type, x-admin-password, x-codex-password",
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { currentPassword, newPassword } = body || {};

    if (!currentPassword || !newPassword || typeof newPassword !== "string") {
      return new Response(
        JSON.stringify({ ok: false, error: "currentPassword and newPassword are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (newPassword.length < 6) {
      return new Response(
        JSON.stringify({ ok: false, error: "Password must be at least 6 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify current password against env or DB
    const envPassword = Deno.env.get("ADMIN_PASSWORD");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let currentOk = false;

    if (envPassword) {
      const encoder = new TextEncoder();
      const a = encoder.encode(currentPassword);
      const b = encoder.encode(envPassword);
      let mismatch = a.length !== b.length ? 1 : 0;
      const len = Math.max(a.length, b.length);
      const aPadded = new Uint8Array(len);
      const bPadded = new Uint8Array(len);
      aPadded.set(a);
      bPadded.set(b);
      for (let i = 0; i < len; i++) {
        mismatch |= aPadded[i] ^ bPadded[i];
      }
      currentOk = mismatch === 0;
    }

    if (!currentOk) {
      // Fall back to DB check
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data } = await supabase
        .from("admin_settings")
        .select("value")
        .eq("key", "admin_password")
        .single();

      if (data) {
        const encoder = new TextEncoder();
        const a = encoder.encode(currentPassword);
        const b = encoder.encode(data.value);
        let mismatch = a.length !== b.length ? 1 : 0;
        const len = Math.max(a.length, b.length);
        const aPadded = new Uint8Array(len);
        const bPadded = new Uint8Array(len);
        aPadded.set(a);
        bPadded.set(b);
        for (let i = 0; i < len; i++) {
          mismatch |= aPadded[i] ^ bPadded[i];
        }
        currentOk = mismatch === 0;
      }
    }

    if (!currentOk) {
      return new Response(
        JSON.stringify({ ok: false, error: "Current password is incorrect" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Update password in DB
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: upsertError } = await supabase
      .from("admin_settings")
      .upsert({ key: "admin_password", value: newPassword, updated_at: new Date().toISOString() },
        { onConflict: "key" });

    if (upsertError) {
      console.error("Failed to update password:", upsertError);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to save new password" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("update-admin-password error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
