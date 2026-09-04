// Server-only administration boundary. Never trust the browser's Gate flag.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const categories = new Set(["description", "benefits", "dosage", "directions", "ingredients", "warnings", "contraindications", "storage", "faq"]);
const locales = new Set(["en-IN", "hi-IN", "gu-IN", "hi-Latn", "gu-Latn"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin") || "";
  const allowed = (Deno.env.get("ADMIN_ALLOWED_ORIGINS") || "https://earthorafarms.com,https://www.earthorafarms.com,http://localhost:5173,http://localhost:3000").split(",").map((v) => v.trim());
  const headers: Record<string, string> = {
    "Content-Type": "application/json", "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-admin-password",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers });
  if (origin && !allowed.includes(origin)) return reply(403, { error: "Origin not allowed" });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { error: "POST required" });
  const password = req.headers.get("x-admin-password");
  if (!password || password.length > 512) return reply(401, { error: "Admin verification required" });

  try {
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Reuse the existing rate-limited server-side password verifier (env/table).
    const { data: verification, error: authError } = await client.functions.invoke("verify-admin", { body: { password } });
    if (authError || verification?.ok !== true) return reply(403, { error: "Admin verification failed" });
    const body = await req.json();
    if (!["create", "update", "status", "delete"].includes(body.action)) return reply(400, { error: "Invalid action" });
    if (body.action !== "create" && !uuid.test(body.id || "")) return reply(400, { error: "Invalid entry ID" });

    if (body.action === "delete") {
      const { error } = await client.from("product_knowledge").delete().eq("id", body.id);
      if (error) throw error;
    } else if (body.action === "status") {
      if (!["draft", "approved", "archived"].includes(body.status)) return reply(400, { error: "Invalid status" });
      const { error } = await client.from("product_knowledge").update({
        status: body.status, approved_at: body.status === "approved" ? new Date().toISOString() : null,
        approved_by: body.status === "approved" ? "verified-admin" : null,
      }).eq("id", body.id);
      if (error) throw error;
    } else {
      if (!categories.has(body.category) || !locales.has(body.locale) || typeof body.content !== "string" || !body.content.trim() || body.content.length > 10000) {
        return reply(400, { error: "Valid category, locale and content (up to 10,000 characters) required" });
      }
      if (body.question != null && (typeof body.question !== "string" || body.question.length > 1000)) return reply(400, { error: "Invalid question" });
      // Edited content must be re-approved; approval never follows arbitrary text changes.
      const values = { category: body.category, locale: body.locale, question: body.question || null,
        content: body.content.trim(), status: "draft", approved_at: null, approved_by: null };
      if (body.action === "create") {
        if (!uuid.test(body.product_id || "")) return reply(400, { error: "Invalid product ID" });
        const { error } = await client.from("product_knowledge").insert({ ...values, product_id: body.product_id });
        if (error) throw error;
      } else {
        const { error } = await client.from("product_knowledge").update(values).eq("id", body.id);
        if (error) throw error;
      }
    }
    return reply(200, { ok: true });
  } catch {
    return reply(500, { error: "Knowledge update failed" });
  }
});
