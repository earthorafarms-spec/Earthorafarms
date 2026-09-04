import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("WhatsApp migration: atomic orders, replay protection, sessions and private privileges", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
    const website = await readFile(new URL("../supabase/migrations/schema_website.sql", import.meta.url), "utf8");
    const agent = await readFile(new URL("../supabase/migrations/schema_agent.sql", import.meta.url), "utf8");
    // Use the project's actual table definitions, not a parallel test schema.
    for (const name of ["products", "orders", "order_items", '"Payments"']) {
      const ddl = website.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\n\\);`))?.[0];
      assert.ok(ddl, `Missing DDL for ${name}`);
      await db.exec(ddl);
    }
    const kb = agent.match(/CREATE TABLE IF NOT EXISTS product_knowledge \([\s\S]*?\n\);/)?.[0];
    assert.ok(kb);
    await db.exec(kb);
    const migration = await readFile(new URL("../supabase/migrations/20260904000000_whatsapp_agent_integration.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(migration); // safe to re-apply
    await db.exec("GRANT USAGE ON SCHEMA public TO service_role, anon; GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;");
    await db.exec("SET ROLE service_role;");
    const productId = "10000000-0000-4000-8000-000000000001";
    await db.query("INSERT INTO products(id, slug, name, mrp, price) VALUES ($1, 'alpha', 'Alpha', 250, 250)", [productId]);
    const order = { id: "order-test", order_number: "ORD-TEST", user_id: "whatsapp:+919876543210", status: "CONFIRMED", total_amount: 500,
      shipping_address: { source: "whatsapp", idempotency_key: "PAY-TEST", name: "Test Customer", city: "Ahmedabad" },
      customer_name: "Test Customer", customer_email: "", customer_phone: "+919876543210", customer_address: "12 Garden Road",
      customer_city: "Ahmedabad", customer_state: "Gujarat", customer_zip: "380001", customer_country: "India", customer_gst: "", created_at: new Date().toISOString() };
    const items = [{ order_id: order.id, product_id: productId, quantity: 2, unit_price: 250, total_price: 500, created_at: order.created_at }];
    const save = (header, rows) => db.query("SELECT save_whatsapp_agent_order($1::jsonb, $2::jsonb)", [JSON.stringify(header), JSON.stringify(rows)]);
    await save(order, items);
    await save(order, items);
    assert.equal((await db.query("SELECT count(*)::int n FROM orders")).rows[0].n, 1);
    assert.equal((await db.query("SELECT count(*)::int n FROM order_items")).rows[0].n, 1);
    assert.equal((await db.query("SELECT shipping_address->>'source' source FROM orders")).rows[0].source, "whatsapp");
    await assert.rejects(save({ ...order, id: "duplicate-order" }, [{ ...items[0], order_id: "duplicate-order" }]), (err) => err.code === "23505");
    // A line-item FK failure rolls back the header update AND restores old items.
    await assert.rejects(save({ ...order, total_amount: 999 }, [{ ...items[0], product_id: "20000000-0000-4000-8000-000000000002" }]), (err) => err.code === "23503");
    assert.equal(Number((await db.query("SELECT total_amount FROM orders")).rows[0].total_amount), 500);
    assert.equal((await db.query("SELECT quantity FROM order_items")).rows[0].quantity, 2);
    const owner = "30000000-0000-4000-8000-000000000003";
    const other = "40000000-0000-4000-8000-000000000004";
    const lock = (token) => db.query("SELECT acquire_whatsapp_agent_lock($1, $2) acquired", ["+919876543210", token]);
    assert.equal((await lock(owner)).rows[0].acquired, true);
    assert.equal((await lock(other)).rows[0].acquired, false);
    await db.query("DELETE FROM whatsapp_agent_locks WHERE phone_number=$1 AND owner=$2", ["+919876543210", other]);
    assert.equal((await lock(other)).rows[0].acquired, false);
    await db.query("DELETE FROM whatsapp_agent_locks WHERE owner=$1", [owner]);
    assert.equal((await lock(other)).rows[0].acquired, true);
    await db.query("SELECT save_whatsapp_agent_session($1,$2,$3::jsonb,$4)", ["+919876543210", owner, '{"state":"awaiting_confirmation"}', new Date(Date.now() + 600000).toISOString()]);
    assert.equal((await db.query("SELECT count(*)::int n FROM whatsapp_agent_sessions")).rows[0].n, 1);
    await db.exec("RESET ROLE; SET ROLE anon;");
    await assert.rejects(db.query("SELECT * FROM whatsapp_agent_sessions"), (err) => err.code === "42501");
    await assert.rejects(save(order, items), (err) => err.code === "42501");
    await assert.rejects(db.query("DELETE FROM product_knowledge"), (err) => err.code === "42501");
  } finally {
    await db.close();
  }
});
