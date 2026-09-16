// Shared CORS helper for Supabase Edge Functions.
//
// Allows requests from:
//   - The prod domain and www subdomain
//   - Local dev servers (Vite / Next default ports)
//   - Any *.netlify.app or *.vercel.app preview deploy (over https)
//   - Anything you list in EXTRA_ALLOWED_ORIGINS (comma-separated env var)
//
// If the origin is not allowed, we echo back the primary prod origin — the
// browser will then block the request. We never send "*" because some
// functions handle credentialed calls (admin passwords, service keys).

// @ts-nocheck
declare const Deno: { env: { get(key: string): string | undefined } };

const DEFAULT_ALLOWED = [
  "https://earthorafarms.com",
  "https://www.earthorafarms.com",
  "http://localhost:5173",
  "http://localhost:3000",
];

function extraAllowedOrigins(): string[] {
  const raw = Deno.env.get("EXTRA_ALLOWED_ORIGINS") || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (DEFAULT_ALLOWED.includes(origin)) return true;
  if (extraAllowedOrigins().includes(origin)) return true;

  // Auto-allow branch/preview deploys on the two hosts we use.
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    if (url.hostname.endsWith(".netlify.app")) return true;
    if (url.hostname.endsWith(".vercel.app")) return true;
  } catch {
    /* invalid Origin header */
  }

  return false;
}

export function buildCorsHeaders(
  req: Request,
  extraAllowHeaders: string = "",
): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowed = isAllowedOrigin(origin) ? origin : DEFAULT_ALLOWED[0];

  const allowHeaders = [
    "authorization",
    "x-client-info",
    "apikey",
    "content-type",
    ...(extraAllowHeaders ? [extraAllowHeaders] : []),
  ].join(", ");

  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": allowHeaders,
    Vary: "Origin",
  };
}
