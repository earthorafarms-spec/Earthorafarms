/** Only billing exhaustion allows key failover; never rotate around rate/access limits. */
export function isSarvamCreditExhausted(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { statusCode?: number; status?: number; body?: { error?: { code?: string } } };
  const status = e.statusCode ?? e.status;
  return status === 402 || (status === undefined && e.body?.error?.code === 'insufficient_quota_error');
}

export function parseSarvamKeys(list?: string, legacyKey?: string): string[] {
  // An explicit list replaces the legacy key so an old exhausted key isn't retried first.
  const keys = (list ?? '').split(/[,\s]+/).map((key) => key.trim()).filter(Boolean);
  return [...new Set(keys.length ? keys : [legacyKey?.trim()].filter((key): key is string => Boolean(key)))];
}

export class SarvamCreditsExhaustedError extends Error {
  readonly code = 'SARVAM_CREDITS_EXHAUSTED';
  readonly statusCode = 402;
  constructor() {
    super('All configured Sarvam keys have exhausted credits. Add credits or configure a funded key.');
    this.name = 'SarvamCreditsExhaustedError';
  }
}

/** Shared across adapters/calls within one server process. Each request attempts a key once. */
export class SarvamKeyPool {
  private readonly keys: string[];
  private readonly exhaustedUntil = new Map<string, number>();

  constructor(keys: string[], private readonly cooldownMs = 300_000, private readonly now = Date.now) {
    this.keys = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
    if (!this.keys.length) throw new Error('Set SARVAM_API_KEYS or SARVAM_API_KEY to use Sarvam.');
  }

  async run<T>(request: (key: string, remainingMs: number) => Promise<T>, timeoutMs: number): Promise<T> {
    const deadline = this.now() + timeoutMs;
    for (let index = 0; index < this.keys.length; index++) {
      const key = this.keys[index];
      if ((this.exhaustedUntil.get(key) ?? 0) > this.now()) continue;
      const remainingMs = deadline - this.now();
      if (remainingMs <= 0) throw new Error('Sarvam request timeout budget exhausted during key failover.');
      try {
        return await request(key, remainingMs);
      } catch (error) {
        if (!isSarvamCreditExhausted(error)) throw error;
        // Do not retain/log SDK errors: they may contain request headers or caller data.
        const alreadyExhausted = (this.exhaustedUntil.get(key) ?? 0) > this.now();
        this.exhaustedUntil.set(key, this.now() + this.cooldownMs);
        if (!alreadyExhausted) {
          console.warn(`[sarvam] key slot ${index + 1}/${this.keys.length} has no credits; skipping for ${this.cooldownMs}ms.`);
        }
      }
    }
    throw new SarvamCreditsExhaustedError();
  }
}
