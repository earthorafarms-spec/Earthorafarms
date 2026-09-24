import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ sql: vi.fn(), json: vi.fn(), array: vi.fn() }));
vi.mock('../../db/client.js', () => ({ sql: Object.assign(mock.sql, { json: mock.json, array: mock.array }) }));
import { invalidateColumnCache, runGatewayQuery } from './gateway.js';

// Keep the driver's real parameter objects/typing without opening any socket.
const codec = postgres({ host: '127.0.0.1', port: 1, max: 1 });
const records: Record<string, any>[] = [];
const cols = ['id', 'slug', 'name', 'highlights', 'health_benefits', 'certifications', 'images', 'faqs', 'seo', 'status'];
beforeEach(() => {
  vi.resetAllMocks(); records.length = 0; invalidateColumnCache();
  mock.array.mockImplementation((value, type) => codec.array(value, type));
  mock.json.mockImplementation(value => codec.json(value));
  mock.sql.mockImplementation((parts, ...values) => {
    if (Array.isArray(parts) && parts.raw) {
      const query = parts.join('');
      if (query.includes('information_schema.columns')) return cols.map(column_name => ({ table_name: 'products', column_name }));
      return [{ id: 'product-id' }];
    }
    if (Array.isArray(parts) && parts[0] && typeof parts[0] === 'object') records.push(...parts);
    else if (parts && typeof parts === 'object' && !Array.isArray(parts)) records.push(parts);
    return { identifierOrBuilder: parts, values };
  });
});
afterAll(async () => { await codec.end(); });

describe('admin gateway PostgreSQL column encoding', () => {
  it.each(['insert', 'update', 'upsert'])('%s encodes highlights as a native text array and images as JSONB', async op => {
    const highlights = ['Gujarati ગુજરાતી', 'quote " and slash \\', 'commas, braces{}'];
    const images = [{ url: '/media/product.png', is_primary: true }];
    await runGatewayQuery({ table: 'products', op, columns: 'id', filters: [{ op: 'eq', col: 'id', value: 'product-id' }], values: { name: 'Product', highlights, images } }, ['admin']);
    expect(mock.array).toHaveBeenCalledExactlyOnceWith(highlights, 1009);
    expect(mock.json).toHaveBeenCalledExactlyOnceWith(images);
    expect(records[0].highlights).toMatchObject({ value: highlights, type: 1009 });
    expect(records[0].highlights.array).toBeDefined();
    expect(records[0].images).toMatchObject({ value: images, type: 3802 });
    expect(records[0].images.array).toBeUndefined();
  });

  it('preserves typed empty highlights and JSON empty images', async () => {
    await runGatewayQuery({ table: 'products', op: 'insert', values: { highlights: [], images: [] } }, ['owner']);
    expect(records[0].highlights).toMatchObject({ type: 1009, value: [] });
    expect(records[0].highlights.array).toBeDefined();
    expect(records[0].images).toMatchObject({ type: 3802, value: [] });
  });

  it('handles only the schema-defined text arrays, retaining FAQ/SEO JSON types', async () => {
    await runGatewayQuery({ table: 'products', op: 'insert', values: { health_benefits: ['Benefit'], certifications: [], faqs: [{ question: 'Q', answer: 'A' }], seo: { title: 'Product' } } }, ['admin']);
    expect(records[0].health_benefits).toMatchObject({ type: 1009, value: ['Benefit'] });
    expect(records[0].certifications).toMatchObject({ type: 1009, value: [] });
    expect(records[0].faqs.type).toBe(3802); expect(records[0].seo.type).toBe(3802);
  });

  it('preserves SQL null rather than converting it to an array or JSON null', async () => {
    await runGatewayQuery({ table: 'products', op: 'insert', values: { highlights: null, images: null } }, ['admin']);
    expect(records[0]).toEqual({ highlights: null, images: null });
    expect(mock.array).not.toHaveBeenCalled(); expect(mock.json).not.toHaveBeenCalled();
  });

  it.each(['not-an-array', ['valid', 123], [['nested']], { text: 'not an array' }])('rejects invalid highlights before a write: %j', async highlights => {
    await expect(runGatewayQuery({ table: 'products', op: 'insert', values: { highlights } }, ['admin'])).rejects.toMatchObject({ statusCode: 400 });
    expect(records).toHaveLength(0);
  });

  it('does not relax staff write permissions', async () => {
    await expect(runGatewayQuery({ table: 'products', op: 'insert', values: { highlights: [] } }, ['viewer'])).rejects.toMatchObject({ statusCode: 403 });
    expect(mock.array).not.toHaveBeenCalled(); expect(records).toHaveLength(0);
  });
});
