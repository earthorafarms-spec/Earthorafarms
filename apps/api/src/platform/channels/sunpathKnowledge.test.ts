import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/client.js', () => ({ sql: vi.fn() }));
vi.mock('../kb/retrieve.js', () => ({ retrieve: vi.fn() }));
import { sql } from '../../db/client.js';
import { retrieve } from '../kb/retrieve.js';
import { approvedVoiceProductKnowledge, indexedVoiceKnowledge, searchVoiceKnowledge, voiceCatalogIds } from './sunpathKnowledge.js';

beforeEach(() => { vi.resetAllMocks(); vi.mocked(sql).mockResolvedValue([]); vi.mocked(retrieve).mockResolvedValue([]); });

describe('Native voice knowledge provenance', () => {
  it('takes exact unique catalogue IDs and does not query canonical data with an empty catalogue', async () => {
    expect(voiceCatalogIds([{ id: 'one' }, { id: 'one' }, { name: 'Guess' }, null, { id: '' }])).toEqual(['one']);
    expect(voiceCatalogIds(null)).toEqual([]);
    expect(await approvedVoiceProductKnowledge('tenant1', [])).toEqual([]);
    expect(sql).not.toHaveBeenCalled();
  });

  it('requires the Earthora tenant, exact active catalogue membership, approval and current effective windows', async () => {
    await approvedVoiceProductKnowledge('tenant1', ['known-product']);
    const [strings, ...values] = vi.mocked(sql).mock.calls[0];
    const query = strings.join(' ');
    for (const guard of ["t.slug = 'earthora'", 't.id =', "p.status = 'active'", 'k.product_id = ANY(', "k.status = 'approved'", 'k.effective_from <= now()', 'k.effective_until >= now()']) expect(query).toContain(guard);
    for (const field of ['k.category', 'k.question', 'k.locale', 'k.version', 'k.status', 'k.approved_at', 'k.effective_from', 'k.effective_until', 'k.id AS source_id']) expect(query).toContain(field);
    expect(values).toEqual(['tenant1', ['known-product']]);
    expect(query).not.toMatch(/left\(|substring\(|DISTINCT ON|LIMIT/i);
  });

  it('retains complete canonical content and every approved effective version', async () => {
    const text = 'Exact approved wording. '.repeat(100);
    const records = [2, 1].map(version => ({ title: 'Product', text, source: 'product_knowledge', source_id: `fact${version}`, product_id: 'p1', category: 'dosage', question: null, locale: 'en-IN', version, status: 'approved' }));
    vi.mocked(sql).mockResolvedValue(records as any);
    expect(await approvedVoiceProductKnowledge('tenant1', ['p1'])).toEqual(records);
  });

  it('keeps tenant/public/effective document guards and preserves retrieval ranking', async () => {
    vi.mocked(sql).mockResolvedValue([{ chunk_id: 'chunk2', title: 'Second' }, { chunk_id: 'chunk1', title: 'First' }] as any);
    const rows = await indexedVoiceKnowledge('tenant1', ['chunk1', 'chunk2']);
    expect(rows.map(row => row.chunk_id)).toEqual(['chunk1', 'chunk2']);
    const query = vi.mocked(sql).mock.calls[0][0].join(' ');
    for (const guard of ['c.tenant_id =', 'd.tenant_id =', "c.visibility = 'public'", "d.visibility = 'public'", "d.status = 'indexed'", 'effective_until', 'c.id = ANY(']) expect(query).toContain(guard);
    for (const field of ['d.id AS source_id', 'c.id AS chunk_id', 'd.product_ids', 'd.uri', 'd.authority', 'd.version']) expect(query).toContain(field);
  });

  it('returns canonical evidence before retrieved documents with no truncation or lost source identity', async () => {
    const canonical = { title: 'Product', text: 'Approved contents. '.repeat(100), source: 'product_knowledge', source_id: 'fact1', product_id: 'p1', category: 'ingredients', version: 1, status: 'approved' };
    const indexed = { title: 'Website', text: 'Indexed text.', source: 'kb_document', source_id: 'doc1', chunk_id: 'chunk1', version: 1, status: 'indexed' };
    vi.mocked(sql).mockImplementation(((strings: TemplateStringsArray) => Promise.resolve(strings.join('').includes('FROM product_knowledge') ? [canonical] : [indexed])) as any);
    vi.mocked(retrieve).mockResolvedValue([{ id: 'chunk1' }] as any);
    expect(await searchVoiceKnowledge('tenant1', ['p1'], 'Product ingredients')).toEqual([canonical, indexed]);
    expect(retrieve).toHaveBeenCalledWith('Product ingredients', { topK: 6 });
  });
});
