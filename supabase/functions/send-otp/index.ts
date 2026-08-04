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

async function verifyPassword(
  supabase: ReturnType<typeof createClient>,
  password: string,
): Promise<boolean> {
  const envPassword = Deno.env.get("ADMIN_PASSWORD");
  if (envPassword) {
    console.log("[send-otp] Verifying against ADMIN_PASSWORD env var");
    return constantTimeEqual(password, envPassword);
  }

  console.log("[send-otp] Verifying against DB admin_settings table");
  const { data, error } = await supabase
    .from("admin_settings")
    .select("value")
    .eq("key", "admin_password")
    .single();

  if (error) {
    console.error("[send-otp] DB error querying admin_password:", error);
    return false;
  }
  if (!data) {
    console.error("[send-otp] No admin_password row found in admin_settings");
    return false;
  }
  return constantTimeEqual(password, data.value);
}

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendEmail(otp: string, domain: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.log(`[send-otp] OTP for ${domain}: ${otp}`);
    return;
  }

  const domainLabel = "Admin Portal";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Earthora Farms <onboarding@resend.dev>",
      to: "earthorafarms@gmail.com",
      subject: `Your ${domainLabel} OTP Code`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fafaf8;border-radius:16px;">
          <h2 style="color:#1b4332;margin:0 0 8px;">${domainLabel}</h2>
          <p style="color:#666;font-size:14px;margin:0 0 24px;">Use the OTP below to complete sign-in.</p>
          <div style="background:#fff;border-radius:12px;padding:24px;text-align:center;border:1px solid #eee;">
            <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#1b4332;font-family:monospace;">${otp}</span>
          </div>
          <p style="color:#999;font-size:12px;margin-top:20px;">This code expires in 5 minutes. If you didn't request this, ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[send-otp] Resend error: ${res.status} ${body}`);
  }
}

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
): Promise<{ allowed: boolean; remaining: number }> {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("rate_limit_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip_address", ip)
    .eq("action", action)
    .gte("attempted_at", since);

  const attemptCount = count ?? 0;
  return { allowed: attemptCount < maxAttempts, remaining: Math.max(0, maxAttempts - attemptCount) };
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
    const password: string | undefined = body?.password;
    const domain = "admin";

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
    const rateCheck = await checkRateLimit(supabase, clientIp, `send-otp:${domain}`);
    if (!rateCheck.allowed) {
      return new Response(
        JSON.stringify({ ok: false, error: "Too many attempts. Try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const valid = await verifyPassword(supabase, password);
    if (!valid) {
      await recordAttempt(supabase, clientIp, `send-otp:${domain}`);
      return new Response(
        JSON.stringify({ ok: false, error: "Incorrect password" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { error: insertErr } = await supabase.from("otp_codes").insert({
      otp,
      domain,
      expires_at: expiresAt,
      used: false,
    });

    if (insertErr) {
      console.error("[send-otp] DB insert error:", insertErr);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to generate OTP" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await sendEmail(otp, domain);

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
