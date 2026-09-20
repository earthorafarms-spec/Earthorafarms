import { conflict, tooMany } from '../../lib/errors.js';

/** One API process: serialize state changes and dedupe bridge HTTP retries. */
export class VoiceTurnQueue {
  private tails = new Map<string, Promise<unknown>>();
  private results = new Map<string, { fingerprint: string; promise: Promise<unknown>; expiresAt: number }>();
  constructor(private ttlMs = 15 * 60_000, private limit = 2048) {}

  run<T>(session: string, turn: string, fingerprint: string, work: () => Promise<T>): Promise<T> {
    const now = Date.now();
    for (const [key, entry] of this.results) if (entry.expiresAt <= now) this.results.delete(key);
    const key = JSON.stringify([session, turn]);
    const existing = this.results.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return Promise.reject(conflict('turn_id was already used for a different utterance'));
      return existing.promise as Promise<T>;
    }
    if (this.results.size >= this.limit) return Promise.reject(tooMany('Voice turn capacity reached'));
    const pending = (this.tails.get(session) || Promise.resolve()).catch(() => undefined).then(work);
    const entry = { fingerprint, promise: pending as Promise<unknown>, expiresAt: Number.POSITIVE_INFINITY };
    this.results.set(key, entry);
    this.tails.set(session, pending);
    const finish = () => {
      entry.expiresAt = Date.now() + this.ttlMs;
      if (this.tails.get(session) === pending) this.tails.delete(session);
    };
    // Remember failures too: retrying after a tool succeeded but its response
    // failed must not repeat a checkout/callback side effect with the same id.
    void pending.then(finish, finish);
    return pending;
  }
}
