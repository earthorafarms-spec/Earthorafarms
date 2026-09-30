import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  tenant: '11111111-1111-4111-8111-111111111111',
  sql: vi.fn((): any => Promise.resolve([{ id: '11111111-1111-4111-8111-111111111111' }])),
  begin: vi.fn(), embed: vi.fn(),
}));
vi.mock('../../db/client.js', () => ({ sql: Object.assign(fixture.sql, { begin: fixture.begin }) }));
vi.mock('../providers/index.js', () => ({ getEmbedding: () => ({ model: 'synthetic', embed: fixture.embed }) }));
vi.mock('./extract.js', () => ({ extractFile: vi.fn(), htmlToText: vi.fn() }));
import { syncProductDocuments, removeStaleProductDocuments } from './ingest.js';

let db: PGlite;
const queries: string[] = [];
const first = '22222222-2222-4222-8222-222222222222';
const second = '33333333-3333-4333-8333-333333333333';
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE products (id uuid PRIMARY KEY, name text, slug text, status text, description text, highlights text[], price numeric, mrp numeric, category text);
    CREATE TABLE inventory (product_id uuid, total_stock integer);
    CREATE TABLE product_knowledge (product_id uuid, category text, question text, content text, status text);
    CREATE TABLE kb_documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, source_id uuid, collection_id uuid,
      title text, uri text, mime text, content_hash text, language text, tags text[], workflow_ids uuid[], product_ids uuid[],
      authority integer, visibility text, summary text, status text, tokens integer, version integer DEFAULT 1,
      updated_at timestamptz DEFAULT now());
    CREATE TABLE kb_chunks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, document_id uuid REFERENCES kb_documents(id) ON DELETE CASCADE,
      collection_id uuid, ordinal integer, content text, context_header text, tokens integer, embedding text, embed_model text,
      tags text[], workflow_ids uuid[], visibility text);
  `);
});
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('TRUNCATE products, inventory, product_knowledge, kb_documents, kb_chunks CASCADE');
  queries.length = 0; fixture.embed.mockReset(); fixture.begin.mockReset(); fixture.sql.mockClear();
  fixture.embed.mockImplementation(async (texts: string[]) => texts.map(() => [0, 1, 0]));
  // Real PostgreSQL statements run in isolated PGlite. The outer advisory
  // transaction's ordering is checked here; no production socket is opened.
  fixture.begin.mockImplementation(async work => work(fixture.sql));
  fixture.sql.mockImplementation((async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce((result, part, index) => result + (index ? '$' + index : '') + part, '');
    queries.push(query);
    if (query.includes('pg_advisory_xact_lock')) return [];
    return (await db.query(query, values)).rows;
  }) as any);
  await db.query(`INSERT INTO products (id,name,slug,status,description,highlights,price,mrp,category)
    VALUES ($1,'Synthetic Tablets','tablets','active','Whole leaf tablets.',ARRAY['First product'],99,199,'wellness'),
      ($2,'Synthetic Herbal Tea','tea','archived','Dried herbal tea.',ARRAY['Second product'],249,299,'wellness')`, [first, second]);
});

describe('product indexing follows publication and immutable product identity', () => {
  it('indexes a second published product and its approved facts without indexing drafts', async () => {
    expect((await syncProductDocuments(null)).documents).toBe(1);
    expect(queries[0]).toContain('pg_advisory_xact_lock');
    expect(queries[1]).toContain('FROM products');
    await db.query("UPDATE products SET status = 'active' WHERE id = $1", [second]);
    await db.query("INSERT INTO product_knowledge VALUES ($1,'ingredients',NULL,'Synthetic approved tea composition.','approved'), ($1,'ingredients',NULL,'UNAPPROVED secret draft composition.','draft')", [second]);
    expect((await syncProductDocuments(null)).documents).toBe(2);
    const chunks = (await db.query<{ content: string }>('SELECT content FROM kb_chunks')).rows.map(row => row.content).join('\n');
    expect(chunks).toContain('Synthetic approved tea composition');
    expect(chunks).not.toContain('UNAPPROVED');
    await db.query("UPDATE products SET status = 'draft' WHERE id = $1", [second]);
    await syncProductDocuments(null); await removeStaleProductDocuments();
    expect((await db.query<{ title: string }>('SELECT title FROM kb_documents')).rows).toEqual([{ title: 'Synthetic Tablets' }]);
  });

  it('renames both title and slug in place and removes earlier duplicated copies with their chunks', async () => {
    await syncProductDocuments(null);
    const original = (await db.query<{ id: string }>('SELECT id FROM kb_documents')).rows[0].id;
    await db.query(`INSERT INTO kb_documents (tenant_id,title,uri,product_ids,content_hash,status,updated_at)
      VALUES ($1,'Historical wrong name','product:tablets',ARRAY[$2]::uuid[],'old','indexed',now()-interval '1 day')`, [fixture.tenant, first]);
    await db.query("INSERT INTO kb_chunks (document_id,content) SELECT id,'Stale historical product text' FROM kb_documents WHERE title='Historical wrong name'");
    await db.query("UPDATE products SET name='Renamed Leaf Tablets', slug='renamed-tablets' WHERE id=$1", [first]);
    await syncProductDocuments(null);
    expect((await db.query('SELECT id,title,uri,version FROM kb_documents')).rows).toEqual([
      { id: original, title: 'Renamed Leaf Tablets', uri: 'product:renamed-tablets', version: 2 },
    ]);
    const contents = (await db.query<{ content: string; context_header: string }>('SELECT content, context_header FROM kb_chunks'))
      .rows.map(row => row.context_header + '\n' + row.content).join('\n');
    expect(contents).toContain('Renamed Leaf Tablets');
    expect(contents).not.toContain('Synthetic Tablets');
    expect(contents).not.toContain('Stale historical product text');
    const calls = fixture.embed.mock.calls.length;
    await syncProductDocuments(null);
    expect(fixture.embed).toHaveBeenCalledTimes(calls);
  });

  it('cleans duplicate product documents even when current text needs no reembedding', async () => {
    await syncProductDocuments(null);
    await db.query(`INSERT INTO kb_documents (tenant_id,title,uri,product_ids,content_hash,status,updated_at)
      VALUES ($1,'Historical name','product:tablets',ARRAY[$2]::uuid[],'old','indexed',now()-interval '1 day')`, [fixture.tenant, first]);
    const calls = fixture.embed.mock.calls.length;
    await syncProductDocuments(null);
    expect((await db.query('SELECT id FROM kb_documents')).rows).toHaveLength(1);
    expect(fixture.embed).toHaveBeenCalledTimes(calls);
  });
});
