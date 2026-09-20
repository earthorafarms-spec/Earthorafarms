/** Native voice evidence only; the shared chat retriever and catalogue stay unchanged. */
import { sql } from '../../db/client.js';
import { retrieve } from '../kb/retrieve.js';

export interface VoiceKnowledge {
  title: string; text: string; source: 'product_knowledge' | 'kb_document';
  source_id: string; product_id?: string; product_ids?: string[]; category?: string;
  question?: string | null; locale?: string; version: number; status: string;
  approved_at?: string | null; effective_from?: string | null; effective_until?: string | null;
  chunk_id?: string; uri?: string | null; authority?: number;
}

export function voiceCatalogIds(catalog: unknown): string[] {
  if (!Array.isArray(catalog)) return [];
  return [...new Set(catalog.flatMap(product => typeof product?.id === 'string' && product.id ? [product.id] : []))];
}

export async function approvedVoiceProductKnowledge(tenantId: string, catalogIds: string[]): Promise<VoiceKnowledge[]> {
  if (!catalogIds.length) return [];
  // The inherited commerce tables are Earthora-specific, without tenant_id.
  // Require the Earthora tenant as well as exact current catalogue membership.
  // Keep every effective approved version; conflicting records must remain visible.
  return sql<VoiceKnowledge[]>`
    SELECT p.name AS title, k.content AS text, 'product_knowledge'::text AS source,
      k.id AS source_id, k.product_id, k.category, k.question, k.locale, k.version,
      k.status, k.approved_at, k.effective_from, k.effective_until
    FROM product_knowledge k JOIN products p ON p.id = k.product_id
    WHERE EXISTS (SELECT 1 FROM tenants t WHERE t.id = ${tenantId} AND t.slug = 'earthora')
      AND p.status = 'active' AND k.product_id = ANY(${catalogIds}::uuid[])
      AND k.status = 'approved' AND k.effective_from <= now()
      AND (k.effective_until IS NULL OR k.effective_until >= now())
    ORDER BY k.version DESC, k.category, k.id`;
}

export async function indexedVoiceKnowledge(tenantId: string, chunkIds?: string[]): Promise<VoiceKnowledge[]> {
  if (chunkIds && !chunkIds.length) return [];
  const rows = await sql<VoiceKnowledge[]>`
    SELECT d.title, left(c.content, 1400) AS text, 'kb_document'::text AS source,
      d.id AS source_id, c.id AS chunk_id, d.product_ids, d.uri, d.authority,
      d.language AS locale, d.version, d.status, d.effective_from, d.effective_until
    FROM kb_chunks c JOIN kb_documents d ON d.id = c.document_id
    WHERE c.tenant_id = ${tenantId} AND d.tenant_id = ${tenantId}
      AND c.visibility = 'public' AND d.visibility = 'public' AND d.status = 'indexed'
      AND (d.effective_from IS NULL OR d.effective_from <= now())
      AND (d.effective_until IS NULL OR d.effective_until > now())
      AND (${chunkIds === undefined} OR c.id = ANY(${chunkIds ?? []}::uuid[]))
    ORDER BY d.authority ASC, d.id, c.id LIMIT 20`;
  // Search results retain the retriever's ranking; context retains authority order.
  return chunkIds ? rows.sort((a, b) => chunkIds.indexOf(a.chunk_id!) - chunkIds.indexOf(b.chunk_id!)) : rows;
}

export async function searchVoiceKnowledge(tenantId: string, catalogIds: string[], query: string): Promise<VoiceKnowledge[]> {
  const [canonical, hits] = await Promise.all([
    approvedVoiceProductKnowledge(tenantId, catalogIds),
    retrieve(query, { topK: 6 }),
  ]);
  const indexed = await indexedVoiceKnowledge(tenantId, hits.map(hit => hit.id));
  // Canonical content is never sliced or rewritten. Python selects the requested
  // product/category before budgeting and keeps provenance through its guard.
  return [...canonical, ...indexed];
}
