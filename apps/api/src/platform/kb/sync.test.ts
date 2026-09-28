import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ enqueueJob: vi.fn(), sql: vi.fn() }));
vi.mock('../../modules/jobs/queue.js', () => ({ enqueueJob: mock.enqueueJob }));
vi.mock('../../db/client.js', () => ({ sql: mock.sql }));
import { DEFAULT_AUTO_SYNC, KB_PAGES_JOB, KB_SYNC_EVERY_MS, KB_SYNC_JOB, KB_WEBSITE_JOB, dueSyncs, enqueueKbSync,
         normalizeAutoSync, readAutoSync, runAutoSyncTick, syncDedupeKey, writeAutoSync } from './sync.js';

beforeEach(() => { vi.resetAllMocks(); });

describe('knowledge base sync triggers', () => {
  it('enqueues one idempotent product sync per minute with the reason recorded', async () => {
    mock.enqueueJob.mockResolvedValue('job-1');
    await expect(enqueueKbSync('gateway-products-update')).resolves.toBe('job-1');
    expect(mock.enqueueJob).toHaveBeenCalledExactlyOnceWith(KB_SYNC_JOB, { reason: 'gateway-products-update' },
      { dedupeKey: syncDedupeKey(KB_SYNC_JOB), maxAttempts: 3 });
    expect(syncDedupeKey(KB_SYNC_JOB, 60_000 * 1234 + 59_999)).toBe('kb_sync_products:1234');
    expect(syncDedupeKey(KB_PAGES_JOB, 60_000 * 1235)).toBe('kb_sync_pages:1235');
  });

  it('never throws into an admin save when the queue is unavailable', async () => {
    mock.enqueueJob.mockRejectedValue(new Error('connection refused'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(enqueueKbSync('knowledge-status')).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('keeps the default schedule at ten minutes', () => {
    expect(KB_SYNC_EVERY_MS).toBe(600_000);
    expect(DEFAULT_AUTO_SYNC.products_every_minutes).toBe(10);
  });
});

describe('automatic sync settings', () => {
  it('normalizes console input within bounds and ignores junk', () => {
    expect(normalizeAutoSync(undefined)).toEqual(DEFAULT_AUTO_SYNC);
    expect(normalizeAutoSync({ enabled: false, products_every_minutes: 0, pages_every_hours: '48', website_crawl_enabled: 'yes', website_crawl_every_hours: 9999 }))
      .toEqual({ ...DEFAULT_AUTO_SYNC, enabled: false, products_every_minutes: 1, pages_every_hours: 48, website_crawl_every_hours: 24 * 30 });
    expect(normalizeAutoSync({ products_every_minutes: 2.6 }).products_every_minutes).toBe(3);
  });

  it('reads defaults when unset and stores normalized JSON', async () => {
    mock.sql.mockResolvedValueOnce([]);
    await expect(readAutoSync()).resolves.toEqual(DEFAULT_AUTO_SYNC);
    mock.sql.mockResolvedValueOnce([{ value: JSON.stringify({ enabled: false, products_every_minutes: 30 }) }]);
    await expect(readAutoSync()).resolves.toEqual({ ...DEFAULT_AUTO_SYNC, enabled: false, products_every_minutes: 30 });
    mock.sql.mockResolvedValueOnce([{ value: 'not json' }]);
    await expect(readAutoSync()).resolves.toEqual(DEFAULT_AUTO_SYNC);
    mock.sql.mockResolvedValueOnce([]);
    await expect(writeAutoSync({ pages_every_hours: 12 })).resolves.toEqual({ ...DEFAULT_AUTO_SYNC, pages_every_hours: 12 });
    const values = mock.sql.mock.calls.at(-1)!.slice(1);
    expect(values[0]).toBe('kb_auto_sync');
    expect(JSON.parse(values[1])).toEqual({ ...DEFAULT_AUTO_SYNC, pages_every_hours: 12 });
  });

  it('decides what is due from the last successful runs and honours the switches', () => {
    const now = 100 * 3_600_000;
    expect(dueSyncs({ ...DEFAULT_AUTO_SYNC, enabled: false }, {}, now)).toEqual([]);
    expect(dueSyncs(DEFAULT_AUTO_SYNC, {}, now)).toEqual([KB_SYNC_JOB, KB_PAGES_JOB]);
    expect(dueSyncs(DEFAULT_AUTO_SYNC, { [KB_SYNC_JOB]: now - 9 * 60_000, [KB_PAGES_JOB]: now - 5 * 3_600_000 }, now)).toEqual([]);
    expect(dueSyncs(DEFAULT_AUTO_SYNC, { [KB_SYNC_JOB]: now - 10 * 60_000, [KB_PAGES_JOB]: now - 6 * 3_600_000 }, now)).toEqual([KB_SYNC_JOB, KB_PAGES_JOB]);
    expect(dueSyncs({ ...DEFAULT_AUTO_SYNC, website_crawl_enabled: true }, { [KB_SYNC_JOB]: now, [KB_PAGES_JOB]: now }, now)).toEqual([KB_WEBSITE_JOB]);
  });

  it('a scheduler tick enqueues only what is due and not already queued', async () => {
    const now = 100 * 3_600_000;
    mock.sql.mockResolvedValueOnce([]);  // settings: defaults
    mock.sql.mockResolvedValueOnce([      // activity: products just ran, pages queued
      { kind: KB_SYNC_JOB, status: 'succeeded', finished_at: new Date(now - 60_000).toISOString() },
      { kind: KB_PAGES_JOB, status: 'pending', finished_at: null },
    ]);
    mock.enqueueJob.mockResolvedValue('job');
    await expect(runAutoSyncTick(now)).resolves.toEqual([]);
    expect(mock.enqueueJob).not.toHaveBeenCalled();
    mock.sql.mockResolvedValueOnce([]);
    mock.sql.mockResolvedValueOnce([{ kind: KB_SYNC_JOB, status: 'succeeded', finished_at: new Date(now - 11 * 60_000).toISOString() }]);
    await expect(runAutoSyncTick(now)).resolves.toEqual([KB_SYNC_JOB, KB_PAGES_JOB]);
    expect(mock.enqueueJob).toHaveBeenCalledTimes(2);
    expect(mock.enqueueJob.mock.calls[0][0]).toBe(KB_SYNC_JOB);
    expect(mock.enqueueJob.mock.calls[1][0]).toBe(KB_PAGES_JOB);
  });
});
