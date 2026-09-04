import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSarvamKeys, SarvamKeyPool, SarvamCreditsExhaustedError } from '../../src/adapters/sarvam-key-pool.js';

const quota = () => ({ statusCode: 402, body: { error: { code: 'insufficient_quota_error' } } });
afterEach(() => vi.restoreAllMocks());

describe('Sarvam key pool', () => {
  it('parses ordered keys, deduplicates, and prefers the list over the legacy key', () => {
    expect(parseSarvamKeys(' first, second\nfirst \t third ', 'old')).toEqual(['first', 'second', 'third']);
    expect(parseSarvamKeys(' , ', ' old ')).toEqual(['old']);
    expect(parseSarvamKeys()).toEqual([]);
    expect(() => new SarvamKeyPool([])).toThrow('Set SARVAM_API_KEYS');
  });

  it('tries all five configured slots in order until one has credits', async () => {
    const pool = new SarvamKeyPool(['one', 'two', 'three', 'four', 'five']);
    const request = vi.fn(async (key: string) => { if (key !== 'five') throw quota(); return 'ok'; });
    expect(await pool.run(request, 15_000)).toBe('ok');
    expect(request.mock.calls.map(([key]) => key)).toEqual(['one', 'two', 'three', 'four', 'five']);
    request.mockClear();
    await pool.run(request, 15_000);
    expect(request.mock.calls.map(([key]) => key)).toEqual(['five']);
  });

  it('bounds exhaustion retries and fails fast on later requests while all keys cool down', async () => {
    const pool = new SarvamKeyPool(['one', 'two']);
    const request = vi.fn(async () => { throw quota(); });
    await expect(pool.run(request, 1_000)).rejects.toBeInstanceOf(SarvamCreditsExhaustedError);
    await expect(pool.run(request, 1_000)).rejects.toThrow('Add credits');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403, 404, 429, 500, 503])('does not rotate for HTTP %s', async (statusCode) => {
    const pool = new SarvamKeyPool(['one', 'two']);
    const error = { statusCode, body: { error: { code: 'insufficient_quota_error' } } };
    const request = vi.fn(async () => { throw error; });
    await expect(pool.run(request, 1_000)).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not rotate for network timeouts', async () => {
    const pool = new SarvamKeyPool(['one', 'two']);
    const error = new Error('timeout');
    const request = vi.fn(async () => { throw error; });
    await expect(pool.run(request, 1_000)).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rechecks a topped-up key after cooldown', async () => {
    let now = 100;
    const pool = new SarvamKeyPool(['one', 'two'], 1_000, () => now);
    const empty = vi.fn(async () => { throw quota(); });
    await expect(pool.run(empty, 1_000)).rejects.toThrow('All configured');
    now += 1_001;
    const recovered = vi.fn(async () => 'ok');
    expect(await pool.run(recovered, 1_000)).toBe('ok');
    expect(recovered.mock.calls.length).toBe(1);
  });

  it('shares one total timeout budget across attempts', async () => {
    let now = 100;
    const pool = new SarvamKeyPool(['one', 'two'], 1_000, () => now);
    const request = vi.fn(async (key: string, remaining: number) => {
      if (key === 'one') { now += 400; throw quota(); }
      return remaining;
    });
    expect(await pool.run(request, 1_000)).toBe(600);
  });

  it('does not attempt another key after the timeout budget is exhausted', async () => {
    let now = 100;
    const pool = new SarvamKeyPool(['one', 'two'], 1_000, () => now);
    const request = vi.fn(async () => { now += 1_001; throw quota(); });
    await expect(pool.run(request, 1_000)).rejects.toThrow('timeout budget');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('concurrent callers each keep their own attempt order, sharing exhausted state', async () => {
    const pool = new SarvamKeyPool(['one', 'two', 'three']);
    const request = vi.fn(async (key: string) => {
      await Promise.resolve();
      if (key !== 'three') throw quota();
      return key;
    });
    expect(await Promise.all([pool.run(request, 1_000), pool.run(request, 1_000)])).toEqual(['three', 'three']);
    request.mockClear();
    await pool.run(request, 1_000);
    expect(request.mock.calls.map(([key]) => key)).toEqual(['three']);
  });

  it('logs only slot numbers, never keys or the original error body', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = new SarvamKeyPool(['fake-secret-key']);
    await expect(pool.run(async () => { throw { ...quota(), message: 'private customer data' }; }, 1_000)).rejects.toThrow('All configured');
    const output = JSON.stringify(warn.mock.calls);
    expect(output).toContain('slot 1/1');
    expect(output).not.toContain('fake-secret-key');
    expect(output).not.toContain('private customer data');
  });
});
