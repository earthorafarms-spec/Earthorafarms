// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

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

async function hashOtp(otp: string): Promise<string> {
  const data = new TextEncoder().encode(otp);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(
  supabase: ReturnType<typeof createClient>,
  password: string,
): Promise<boolean> {
  const envPassword = Deno.env.get("ADMIN_PASSWORD");
  if (envPassword) {
    return constantTimeEqual(password, envPassword);
  }

  const { data, error } = await supabase
    .from("admin_settings")
    .select("value")
    .eq("key", "admin_password")
    .single();

  if (error || !data) return false;
  return constantTimeEqual(password, data.value);
}

async function verifyKaccCredentials(
  supabase: ReturnType<typeof createClient>,
  email: string,
  password: string,
): Promise<{ valid: boolean; errorMsg?: string }> {
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return { valid: false, errorMsg: "Valid email address is required" };
  }

  const { data, error } = await supabase
    .from("kacc_users")
    .select("password")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  if (error || !data) {
    return { valid: false, errorMsg: "Unauthorized email address for Key Accounts portal" };
  }

  const matches = constantTimeEqual(password, data.password);
  if (!matches) {
    return { valid: false, errorMsg: "Incorrect password for Key Accounts portal" };
  }

  return { valid: true };
}

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendEmail(otp: string, domain: string, recipientEmail?: string): Promise<{ success: boolean; resendError?: string }> {
  const apiKey = domain === "kacc"
    ? (Deno.env.get("RESEND_API_KEY_KACC") || Deno.env.get("RESEND_API_KEY"))
    : (Deno.env.get("RESEND_API_KEY_ADMIN") || Deno.env.get("RESEND_API_KEY"));

  const targetEmail = (recipientEmail && recipientEmail.trim()) ? recipientEmail.trim() : "earthorafarms@gmail.com";

  if (!apiKey) {
    // No email provider configured — OTP not delivered via email
    return { success: true };
  }

  const domainLabel = domain === "kacc" ? "Key Accounts Portal" : "Admin Portal";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Earthora Farms <onboarding@resend.dev>",
        to: targetEmail,
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
      const errText = await res.text();
      console.error(`[send-otp] Resend API error for ${domain}: ${res.status}`);
      return { success: false, resendError: errText };
    }
    return { success: true };
  } catch (err: any) {
    console.error("[send-otp] Email dispatch exception:", err?.message);
    return { success: false, resendError: err?.message };
  }
}

function getClientIp(req: Request): string {
  // CF-Connecting-IP is set by Cloudflare and cannot be spoofed by request sender
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
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
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as any;
    const password: string | undefined = body?.password;
    const email: string | undefined = body?.email;
    const domain: string = (body?.domain && typeof body.domain === "string") ? body.domain : "admin";

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

    if (domain === "kacc") {
      if (!email || typeof email !== "string") {
        return new Response(
          JSON.stringify({ ok: false, error: "No email address provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const kaccCheck = await verifyKaccCredentials(supabase, email, password);
      if (!kaccCheck.valid) {
        await recordAttempt(supabase, clientIp, `send-otp:${domain}:${email}`);
        return new Response(
          JSON.stringify({ ok: false, error: kaccCheck.errorMsg || "Invalid Key Accounts credentials" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else {
      const valid = await verifyPassword(supabase, password);
      if (!valid) {
        await recordAttempt(supabase, clientIp, `send-otp:${domain}`);
        return new Response(
          JSON.stringify({ ok: false, error: "Incorrect password" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Invalidate any existing unused OTPs for this domain before inserting new one
    await supabase
      .from("otp_codes")
      .delete()
      .eq("domain", domain)
      .eq("used", false)
      .gte("expires_at", new Date().toISOString());

    const { error: insertErr } = await supabase.from("otp_codes").insert({
      otp: otpHash,
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

    const mailResult = await sendEmail(otp, domain, email);

    return new Response(
      JSON.stringify({
        ok: true,
        sent: mailResult.success,
        resendError: mailResult.resendError || null,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid request" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
