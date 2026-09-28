/** Keep the knowledge base's product documents in step with the live catalogue.

The catalogue and approved product facts are read live by every voice turn, but the
indexed product documents used by keyword/semantic search were only rebuilt by a
manual "index website" job. Any product, stock or knowledge change now enqueues a
sync, and the worker also runs one every ten minutes as a safety net. */
import { enqueueJob } from '../../modules/jobs/queue.js';

export const KB_SYNC_JOB = 'kb_sync_products';
export const KB_SYNC_EVERY_MS = 10 * 60_000;

/** At most one queued sync per minute, whatever triggered it; the job itself is idempotent. */
export function kbSyncDedupeKey(now = Date.now()): string {
  return `kb-sync-products:${Math.floor(now / 60_000)}`;
}

/** Best effort: an admin save must never fail because the job queue is unavailable. */
export async function enqueueKbSync(reason: string): Promise<string | null> {
  try {
    return await enqueueJob(KB_SYNC_JOB, { reason }, { dedupeKey: kbSyncDedupeKey(), maxAttempts: 3 });
  } catch (err) {
    console.warn(`[kb] product sync enqueue failed (${reason}): ${(err as Error).message}`);
    return null;
  }
}
