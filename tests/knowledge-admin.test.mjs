import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

async function harness(verified) {
  let handler;
  const writes = [];
  const table = {
    insert: async (data) => { writes.push(data); return { error: null }; },
    update: (data) => ({ eq: async () => { writes.push(data); return { error: null }; } }),
    delete: () => ({ eq: async () => { writes.push("delete"); return { error: null }; } }),
  };
  const client = { functions: { invoke: async () => ({ data: { ok: verified }, error: null }) }, from: () => table };
  const source = await readFile(new URL("../supabase/functions/manage-product-knowledge/index.ts", import.meta.url), "utf8");
  const corsSource = await readFile(new URL("../supabase/functions/_shared/cors.ts", import.meta.url), "utf8");
  const Deno = { env: { get: () => undefined }, serve: (fn) => { handler = fn; } };
  // The handler now also imports the local CORS helper. Removing only its first
  // import left CommonJS exports/require in a script-only VM. Load both modules
  // explicitly, retaining the real CORS rules and mocking only the database SDK.
  function evaluate(sourceText, imports = {}) {
    const module = { exports: {} };
    const js = ts.transpileModule(sourceText, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(js, { Request, Response, URL, Set, Date, JSON, Deno, module, exports: module.exports,
      require: (name) => {
        if (!Object.hasOwn(imports, name)) throw new Error(`Unexpected test module: ${name}`);
        return imports[name];
      } });
    return module.exports;
  }
  evaluate(source, {
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => client },
    "../_shared/cors.ts": evaluate(corsSource),
  });
  assert.equal(typeof handler, "function", "The real Deno handler must be registered");
  return { writes, request: (body, password = "test-admin-password", origin) => handler(new Request("https://example.test", {
    method: "POST", headers: { "content-type": "application/json", "x-admin-password": password, ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
  })) };
}

test("knowledge mutations reject unverified administrators", async () => {
  const h = await harness(false);
  assert.equal((await h.request({ action: "delete", id: "10000000-0000-4000-8000-000000000001" })).status, 403);
  assert.equal(h.writes.length, 0);
});

test("new and edited knowledge cannot smuggle approval or unknown fields", async () => {
  const h = await harness(true);
  const reply = await h.request({ action: "create", product_id: "10000000-0000-4000-8000-000000000001",
    category: "benefits", locale: "gu-Latn", content: "Approved factual text", status: "approved", approved_by: "attacker" });
  assert.equal(reply.status, 200);
  assert.equal(h.writes[0].status, "draft");
  assert.equal(h.writes[0].approved_by, null);
  assert.equal(h.writes[0].locale, "gu-Latn");
});

test("knowledge validates supported languages and rejects absent password", async () => {
  const h = await harness(true);
  assert.equal((await h.request({ action: "create" }, "")).status, 401);
  assert.equal((await h.request({ action: "create", category: "benefits", locale: "unknown", content: "text" })).status, 400);
  assert.equal((await h.request({ action: "delete", id: "10000000-0000-4000-8000-000000000001" }, "test-admin-password", "https://untrusted.example")).status, 403);
  assert.equal(h.writes.length, 0);
});
