import { createHash } from 'node:crypto';
import { sql } from '../../db/client.js';
import { getEmbedding } from '../providers/index.js';
import { chunkText } from './chunk.js';
import { extractFile, htmlToText } from './extract.js';

const EARTHORA = sql<{ id: string }[]>`SELECT id FROM tenants WHERE slug = 'earthora'`;
export async function tenantId(): Promise<string> { return (await EARTHORA)[0].id; }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Upserts a document, re-chunks + re-embeds it, swaps chunks atomically. Returns chunk count. */
export async function indexDocument(input: {
  sourceId: string | null; collectionId: string | null; title: string; uri?: string; mime?: string;
  text: string; language?: string; tags?: string[]; workflowIds?: string[]; productIds?: string[];
  authority?: number; visibility?: 'public' | 'internal'; summary?: string;
}): Promise<{ documentId: string; chunks: number; skipped: boolean }> {
  const tid = await tenantId();
  const hash = sha(input.text);
  const [existing] = await sql<{ id: string; content_hash: string }[]>`SELECT id, content_hash FROM kb_documents WHERE tenant_id = ${tid} AND uri = ${input.uri ?? null} AND title = ${input.title} LIMIT 1`;
  if (existing && existing.content_hash === hash) return { documentId: existing.id, chunks: 0, skipped: true };

  const chunks = chunkText(input.text, { docTitle: input.title, docSummary: input.summary });
  const embed = getEmbedding();
  const vectors = chunks.length ? await embed.embed(chunks.map((c) => `${c.contextHeader}\n${c.content}`)) : [];

  const documentId = await sql.begin(async (tx) => {
    let docId: string;
    if (existing) {
      docId = existing.id;
      await tx`UPDATE kb_documents SET content_hash = ${hash}, mime = ${input.mime ?? 'text/plain'}, language = ${input.language ?? 'en'},
        tags = ${input.tags ?? []}, workflow_ids = ${(input.workflowIds ?? []) as any}, product_ids = ${(input.productIds ?? []) as any},
        authority = ${input.authority ?? 3}, visibility = ${input.visibility ?? 'public'}, summary = ${input.summary ?? ''},
        collection_id = ${input.collectionId}, status = 'indexed', version = version + 1, tokens = ${chunks.reduce((s, c) => s + c.tokens, 0)}, updated_at = now() WHERE id = ${docId}`;
      await tx`DELETE FROM kb_chunks WHERE document_id = ${docId}`;
    } else {
      const [d] = await tx<{ id: string }[]>`INSERT INTO kb_documents (tenant_id, source_id, collection_id, title, uri, mime, content_hash, language, tags, workflow_ids, product_ids, authority, visibility, summary, status, tokens)
        VALUES (${tid}, ${input.sourceId}, ${input.collectionId}, ${input.title}, ${input.uri ?? null}, ${input.mime ?? 'text/plain'}, ${hash}, ${input.language ?? 'en'}, ${input.tags ?? []}, ${(input.workflowIds ?? []) as any}, ${(input.productIds ?? []) as any}, ${input.authority ?? 3}, ${input.visibility ?? 'public'}, ${input.summary ?? ''}, 'indexed', ${chunks.reduce((s, c) => s + c.tokens, 0)}) RETURNING id`;
      docId = d.id;
    }
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      await tx`INSERT INTO kb_chunks (tenant_id, document_id, collection_id, ordinal, content, context_header, tokens, embedding, embed_model, tags, workflow_ids, visibility)
        VALUES (${tid}, ${docId}, ${input.collectionId}, ${c.ordinal}, ${c.content}, ${c.contextHeader}, ${c.tokens}, ${toVector(vectors[i])}, ${embed.model}, ${input.tags ?? []}, ${(input.workflowIds ?? []) as any}, ${input.visibility ?? 'public'})`;
    }
    return docId;
  });
  return { documentId, chunks: chunks.length, skipped: false };
}

function toVector(v: number[] | undefined): string | null { return v ? `[${v.join(',')}]` : null; }

/** Crawl a website (BFS, same-origin, depth/page-limited) and index each page. */
export async function crawlWebsite(sourceId: string | null, collectionId: string | null, opts: { startUrl: string; maxPages?: number; maxDepth?: number; tags?: string[] }): Promise<{ pages: number; chunks: number }> {
  const maxPages = opts.maxPages ?? 40; const maxDepth = opts.maxDepth ?? 3;
  const origin = new URL(opts.startUrl).origin;
  const seen = new Set<string>(); const queue: { url: string; depth: number }[] = [{ url: opts.startUrl, depth: 0 }];
  let pages = 0; let totalChunks = 0;
  while (queue.length && pages < maxPages) {
    const { url, depth } = queue.shift()!;
    const clean = url.split('#')[0];
    if (seen.has(clean)) continue; seen.add(clean);
    let html: string;
    try {
      const res = await fetch(clean, { headers: { 'User-Agent': 'EarthoraKB/1.0' }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) continue;
      html = await res.text();
    } catch { continue; }
    const { title, text } = htmlToText(html, clean);
    if (text.length > 120) {
      const r = await indexDocument({ sourceId, collectionId, title: title || clean, uri: clean, mime: 'text/html', text, tags: opts.tags });
      totalChunks += r.chunks; pages++;
    }
    if (depth < maxDepth) {
      for (const m of html.matchAll(/href=["']([^"'#]+)["']/g)) {
        try { const abs = new URL(m[1], clean); if (abs.origin === origin && /^https?:/.test(abs.protocol) && !abs.pathname.match(/\.(png|jpe?g|svg|webp|pdf|zip|css|js|ico|woff2?)$/i)) queue.push({ url: abs.href, depth: depth + 1 }); } catch { /* skip */ }
      }
    }
  }
  return { pages, chunks: totalChunks };
}

/** DB-sync: one document per active product from its DB fields + approved knowledge. */
export async function syncProductDocuments(collectionId: string | null): Promise<{ documents: number; chunks: number }> {
  const products = await sql<any[]>`SELECT p.id, p.name, p.slug, p.description, p.highlights, p.price, p.mrp, p.category,
    COALESCE(i.total_stock,0) AS stock FROM products p LEFT JOIN inventory i ON i.product_id = p.id WHERE p.status = 'active'`;
  let docs = 0; let chunks = 0;
  for (const p of products) {
    const facts = await sql<any[]>`SELECT category, question, content FROM product_knowledge WHERE product_id = ${p.id} AND status = 'approved' ORDER BY category`;
    const parts = [`# ${p.name}`, p.description || '', ''];
    if (Array.isArray(p.highlights) && p.highlights.length) parts.push('## Highlights', p.highlights.map((h: string) => `- ${h}`).join('\n'), '');
    for (const f of facts) parts.push(`## ${f.category}${f.question ? ` — ${f.question}` : ''}`, f.content, '');
    const r = await indexDocument({ sourceId: null, collectionId, title: p.name, uri: `product:${p.slug}`, mime: 'text/markdown', text: parts.join('\n'), tags: ['product', p.slug], productIds: [p.id], authority: 2, summary: `Product information for ${p.name}` });
    docs++; chunks += r.chunks;
  }
  return { documents: docs, chunks };
}

export async function ingestFile(input: { sourceId: string | null; collectionId: string | null; filename: string; mime: string; bytes: Buffer; tags?: string[]; workflowIds?: string[] }): Promise<{ documentId: string; chunks: number }> {
  const { title, text } = await extractFile(input.bytes, input.mime, input.filename);
  const r = await indexDocument({ sourceId: input.sourceId, collectionId: input.collectionId, title: title || input.filename, uri: `file:${input.filename}`, mime: input.mime, text, tags: input.tags, workflowIds: input.workflowIds });
  return { documentId: r.documentId, chunks: r.chunks };
}
