import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ sql: vi.fn(), embed: vi.fn() }));
vi.mock('../../db/client.js', () => ({ sql: mock.sql }));
vi.mock('../providers/index.js', () => ({ getEmbedding: () => ({ embed: mock.embed }) }));
import { retrieve } from './retrieve.js';
import { withVoiceScope } from '../providers/voiceScope.js';

beforeEach(() => {
  vi.resetAllMocks();
  mock.embed.mockResolvedValue([[0.1, 0.2]]);
  mock.sql.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
    if (strings.join('').includes('SELECT c.id')) return Promise.resolve([{ id: 'c1', document_id: 'd1', document_title: 'Approved facts', content: 'Moringa tablets', context_header: '', authority: 1, uri: null, vscore: 0.8, kscore: 0.6 }]);
    return { query: strings.join('?'), values };
  });
});

describe('voice knowledge retrieval', () => {
  it('keeps approved/effective/public/workflow/tenant filters without any paid embedding call', async () => {
    const hits = await withVoiceScope('voice-tenant', () => retrieve('what is the moringa price', { workflowId: 'wf', tags: ['product'] }));
    expect(hits).toHaveLength(1); expect(mock.embed).not.toHaveBeenCalled();
    const queries = mock.sql.mock.calls.map(([strings]) => strings.join('?')).join('\n');
    expect(queries).toContain("c.visibility = 'public'"); expect(queries).toContain('effective_until'); expect(queries).toContain('workflow_ids'); expect(queries).toContain('c.tenant_id');
    expect(mock.sql.mock.calls.some((call) => call.includes('voice-tenant'))).toBe(true);
    expect(mock.sql.mock.calls.some((call) => call.includes('moringa | price'))).toBe(true);
  });
  it('preserves vector plus keyword retrieval for concurrent storefront chat', async () => {
    await retrieve('moringa price');
    expect(mock.embed).toHaveBeenCalledWith(['moringa price']);
    expect(mock.sql.mock.calls.filter(([strings]) => strings.join('').includes('SELECT c.id'))).toHaveLength(2);
  });
});
