import type { FastifyBaseLogger } from 'fastify';
import { claimJob, completeJob, failJob, type JobRow } from './queue.js';

export type JobHandler = (job: JobRow, log: FastifyBaseLogger) => Promise<unknown>;

const handlers = new Map<string, JobHandler>();
export function registerJobHandler(kind: string, handler: JobHandler): void { handlers.set(kind, handler); }
export function registeredJobKinds(): string[] { return [...handlers.keys()]; }

export interface Schedule { name: string; everyMs: number; run: (log: FastifyBaseLogger) => Promise<void>; lastRun?: number }
const schedules: Schedule[] = [];
export function registerSchedule(s: Schedule): void { schedules.push(s); }

/** Long-running loop: claims jobs for registered kinds, runs schedules, exits cleanly on stop(). */
export function startWorker(log: FastifyBaseLogger, opts: { concurrency?: number; pollMs?: number } = {}) {
  const concurrency = opts.concurrency ?? 3;
  const pollMs = opts.pollMs ?? 750;
  let stopped = false;
  let inflight = 0;
  const kinds = registeredJobKinds();
  log.info({ kinds, concurrency }, 'job worker starting');

  const runOne = async (job: JobRow) => {
    const handler = handlers.get(job.kind);
    if (!handler) { await failJob(job, new Error(`no handler for ${job.kind}`)); return; }
    const started = Date.now();
    try {
      const result = await handler(job, log.child({ job: job.id, kind: job.kind }));
      await completeJob(job.id, result);
      log.info({ job: job.id, kind: job.kind, ms: Date.now() - started }, 'job done');
    } catch (err) {
      const uncertain = err instanceof Error && (err as Error & { uncertain?: boolean }).uncertain === true;
      log.error({ job: job.id, kind: job.kind, err, uncertain }, 'job failed');
      await failJob(job, err, { uncertain });
    }
  };

  const loop = async () => {
    while (!stopped) {
      let claimed = false;
      if (inflight < concurrency && kinds.length) {
        try {
          const job = await claimJob(kinds);
          if (job) {
            claimed = true; inflight++;
            void runOne(job).finally(() => { inflight--; });
          }
        } catch (err) { log.error({ err }, 'claim failed'); }
      }
      const now = Date.now();
      for (const s of schedules) {
        if (!s.lastRun || now - s.lastRun >= s.everyMs) {
          s.lastRun = now;
          s.run(log.child({ schedule: s.name })).catch((err) => log.error({ err, schedule: s.name }, 'schedule failed'));
        }
      }
      if (!claimed) await new Promise((r) => setTimeout(r, pollMs));
    }
  };
  const done = loop();
  return {
    stop: async () => { stopped = true; await done; const deadline = Date.now() + 30_000; while (inflight > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200)); },
  };
}
