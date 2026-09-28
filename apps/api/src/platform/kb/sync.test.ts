import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ enqueueJob: vi.fn() }));
vi.mock('../../modules/jobs/queue.js', () => ({ enqueueJob: mock.enqueueJob }));
import { KB_SYNC_EVERY_MS, KB_SYNC_JOB, enqueueKbSync, kbSyncDedupeKey } from './sync.js';

beforeEach(() => { vi.resetAllMocks(); });

describe('knowledge base product sync trigger', () => {
  it('enqueues one idempotent sync job per minute with the reason recorded', async () => {
    mock.enqueueJob.mockResolvedValue('job-1');
    await expect(enqueueKbSync('gateway-products')).resolves.toBe('job-1');
    expect(mock.enqueueJob).toHaveBeenCalledExactlyOnceWith(KB_SYNC_JOB, { reason: 'gateway-products' },
      { dedupeKey: kbSyncDedupeKey(), maxAttempts: 3 });
    expect(kbSyncDedupeKey(60_000 * 1234 + 59_999)).toBe('kb-sync-products:1234');
    expect(kbSyncDedupeKey(60_000 * 1235)).toBe('kb-sync-products:1235');
  });

  it('never throws into an admin save when the queue is unavailable', async () => {
    mock.enqueueJob.mockRejectedValue(new Error('connection refused'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(enqueueKbSync('knowledge-status')).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('runs the safety-net schedule every ten minutes', () => {
    expect(KB_SYNC_EVERY_MS).toBe(600_000);
  });
});
