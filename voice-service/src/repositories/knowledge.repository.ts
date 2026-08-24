import { supabase } from '../lib/supabaseClient.js';

export const KNOWLEDGE_CATEGORIES = [
  'description', 'benefits', 'dosage', 'directions', 'ingredients',
  'warnings', 'contraindications', 'storage', 'faq',
] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export interface KnowledgeEntry {
  id: string;
  productId: string;
  category: KnowledgeCategory;
  question: string | null;
  content: string;
  version: number;
  /** Source language of `content` (e.g. 'en-IN', 'hi-IN', 'gu-IN') — see product_knowledge.locale. */
  locale: string;
}

interface DbKnowledgeRow {
  id: string;
  product_id: string;
  category: KnowledgeCategory;
  question: string | null;
  content: string;
  version: number;
  locale: string;
}

/**
 * Only ever returns `approved` rows that are currently within their
 * effective window. This is the entire grounding surface for anything the
 * agent says about benefits/dosage/warnings/etc — if nothing matches, the
 * caller (tools/knowledge.ts) must return `not_found` and the agent must
 * use the approved refusal fallback, never fall back to its own knowledge.
 */
export async function getApprovedKnowledge(
  productId: string,
  category: KnowledgeCategory
): Promise<KnowledgeEntry[]> {
  const nowIso = new Date().toISOString();

  // Deliberately not filtered by locale in SQL: an admin may only have
  // authored an English entry, and a Hindi/Gujarati caller should still get
  // grounded content to translate from rather than a refusal. Returning
  // every approved entry (with its locale tagged) lets the model prefer a
  // same-language entry when one exists, per LANGUAGE rules in prompt.ts.
  const { data, error } = await supabase
    .from('product_knowledge')
    .select('id, product_id, category, question, content, version, locale')
    .eq('product_id', productId)
    .eq('category', category)
    .eq('status', 'approved')
    .lte('effective_from', nowIso)
    .or(`effective_until.is.null,effective_until.gte.${nowIso}`)
    .order('version', { ascending: false });

  if (error) throw error;

  return ((data ?? []) as DbKnowledgeRow[]).map((row) => ({
    id: row.id,
    productId: row.product_id,
    category: row.category,
    question: row.question,
    content: row.content,
    version: row.version,
    locale: row.locale,
  }));
}
