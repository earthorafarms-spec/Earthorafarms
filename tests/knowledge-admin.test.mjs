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
  // Run the real handler in an isolated VM with a mocked server-side client.
  const js = ts.transpileModule(source.replace(/^import .*;\r?\n/m, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  vm.runInNewContext(js, { Request, Response, Set, Date, JSON, createClient: () => client,
    Deno: { env: { get: () => undefined }, serve: (fn) => { handler = fn; } } });
  return { writes, request: (body, password = "test-admin-password") => handler(new Request("https://example.test", {
    method: "POST", headers: { "content-type": "application/json", "x-admin-password": password }, body: JSON.stringify(body),
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
  assert.equal(h.writes.length, 0);
});
