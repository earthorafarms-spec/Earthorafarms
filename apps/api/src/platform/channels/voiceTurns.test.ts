import { describe, expect, it, vi } from 'vitest';
import { VoiceTurnQueue } from './voiceTurns.js';

describe('voice turn ordering', () => {
  it('waits for prior state writes for the same session but lets other calls proceed', async () => {
    const queue = new VoiceTurnQueue(); const seen: string[] = [];
    let release!: () => void;
    const first = queue.run('one', 'a', 'one-a', async () => { seen.push('a'); await new Promise<void>((resolve) => { release = resolve; }); return 'a'; });
    const second = queue.run('one', 'b', 'one-b', async () => { seen.push('b'); return 'b'; });
    const other = queue.run('two', 'a', 'two-a', async () => { seen.push('other'); return 'other'; });
    await other;
    expect(seen).toEqual(['a', 'other']);
    release(); expect(await Promise.all([first, second])).toEqual(['a', 'b']);
    expect(seen).toEqual(['a', 'other', 'b']);
  });
  it('bounds memory without evicting an active turn or a retry result', async () => {
    const queue = new VoiceTurnQueue(20, 1); const work = vi.fn(async () => 1);
    expect(await queue.run('one', 'a', 'same', work)).toBe(1);
    await expect(queue.run('two', 'a', 'other', work)).rejects.toMatchObject({ statusCode: 429 });
    expect(await queue.run('one', 'a', 'same', work)).toBe(1);
    expect(work).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(await queue.run('two', 'a', 'other', work)).toBe(1);
  });
});
