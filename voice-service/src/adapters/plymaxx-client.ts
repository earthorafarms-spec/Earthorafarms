// Shared HTTP plumbing for the self-hosted Plymaxx AI server (Whisper STT,
// IndicConformer STT, Piper TTS and Qwen behind an OpenAI-shaped API).
//
// One place owns authentication, timeouts, cancellation and error mapping so
// the three capability adapters stay about speech and conversation. The API
// key is read from config and sent as a bearer token; it is never logged, and
// error messages deliberately carry the upstream status, not the request
// headers.

import { config } from '../config.js';
import { AdapterNotConfiguredError } from './types.js';

/** An upstream call that failed, classified so callers can react sensibly. */
export type PlymaxxFailureKind =
  | 'auth' // 401/403 — key rejected or account disabled
  | 'input' // 413/422 — audio or text violated a documented limit
  | 'busy' // 429 — the shared model queue is full
  | 'upstream' // 5xx — model service warming up, crashed or timed out
  | 'network'; // transport failure or timeout on our side

export class PlymaxxRequestError extends Error {
  readonly kind: PlymaxxFailureKind;
  readonly status: number | null;
  /** Seconds the server asked us to wait, when it said so. */
  readonly retryAfterSeconds: number | null;

  constructor(message: string, kind: PlymaxxFailureKind, status: number | null, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'PlymaxxRequestError';
    this.kind = kind;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  /** True when waiting and trying the same request again is reasonable. */
  get retryable(): boolean {
    return this.kind === 'busy' || this.kind === 'upstream';
  }
}

export function plymaxxConfigured(): boolean {
  return Boolean(config.AI_BASE_URL && config.AI_API_KEY);
}

function requireConfig(adapterName: string): { baseUrl: string; apiKey: string } {
  if (!config.AI_BASE_URL || !config.AI_API_KEY) {
    throw new AdapterNotConfiguredError(
      adapterName,
      'AI_BASE_URL/AI_API_KEY are unset. Load them from the Plymaxx credential helper, or choose a different provider.',
    );
  }
  return { baseUrl: config.AI_BASE_URL.replace(/\/$/, ''), apiKey: config.AI_API_KEY };
}

export function plymaxxAuthHeader(adapterName: string): Record<string, string> {
  return { Authorization: `Bearer ${requireConfig(adapterName).apiKey}` };
}

/** Resolves a configured absolute URL, or a path against AI_BASE_URL. */
export function plymaxxUrl(adapterName: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const { baseUrl } = requireConfig(adapterName);
  return `${baseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

function parseRetryAfter(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function classify(status: number): PlymaxxFailureKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 413 || status === 422 || status === 400) return 'input';
  if (status === 429) return 'busy';
  return 'upstream';
}

/**
 * Reads a bounded slice of an error body. Upstream errors are small JSON
 * objects; this keeps a runaway HTML error page out of the logs.
 */
async function describeFailure(response: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await response.text()).slice(0, 300);
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string }; detail?: unknown };
      detail = parsed.error?.message ?? (typeof parsed.detail === 'string' ? parsed.detail : body);
    } catch {
      detail = body;
    }
  } catch {
    detail = '(no response body)';
  }
  return detail.replace(/\s+/g, ' ').trim();
}

export interface PlymaxxRequestOptions {
  adapterName: string;
  /** Absolute URL, or a path resolved against AI_BASE_URL. */
  url: string;
  /** JSON string for chat/speech, FormData for audio uploads. */
  body: string | FormData;
  /** Set for JSON requests; omitted for FormData so fetch sets the boundary. */
  jsonContentType?: boolean;
  timeoutMs: number;
  /** Caller-owned cancellation (barge-in). Aborting never retries. */
  signal?: AbortSignal;
  /**
   * Retry once when the shared queue is busy or a model is warming up. Off by
   * default: a voice turn that is already late is better failed over to the
   * fallback provider than retried.
   */
  retryOnBusy?: boolean;
}

/**
 * Performs one authenticated request, mapping transport and HTTP failures
 * onto PlymaxxRequestError. Returns the live Response so streaming callers can
 * read the body progressively.
 */
export async function plymaxxFetch(options: PlymaxxRequestOptions): Promise<Response> {
  const { adapterName, timeoutMs, signal, retryOnBusy = false } = options;
  const url = plymaxxUrl(adapterName, options.url);
  const headers: Record<string, string> = plymaxxAuthHeader(adapterName);
  if (options.jsonContentType) headers['Content-Type'] = 'application/json';

  const attempt = async (): Promise<Response> => {
    // Either the caller's barge-in or our own deadline ends the request.
    // Composed by hand rather than with AbortSignal.any(), which needs Node
    // >= 20.3: this service pins no Node version and builds for node20, so
    // relying on it could fail at runtime rather than at build time. Doing it
    // manually also lets us detach the listener, so a long-lived caller signal
    // does not accumulate one per request.
    const composite = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      composite.abort();
    }, timeoutMs);

    const onCallerAbort = (): void => composite.abort();
    if (signal) {
      if (signal.aborted) composite.abort();
      else signal.addEventListener('abort', onCallerAbort, { once: true });
    }

    const detach = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);
    };

    let response: Response;
    try {
      response = await fetch(url, { method: 'POST', headers, body: options.body, signal: composite.signal });
    } catch (err) {
      detach();
      if (signal?.aborted) throw err; // caller cancelled — surface as-is
      const reason = err instanceof Error ? err.message : String(err);
      throw new PlymaxxRequestError(
        timedOut
          ? `${adapterName}: no response within ${timeoutMs}ms.`
          : `${adapterName}: request failed (${reason}).`,
        'network',
        null,
      );
    }

    if (!response.ok) {
      detach();
      const kind = classify(response.status);
      throw new PlymaxxRequestError(
        `${adapterName}: upstream returned ${response.status} — ${await describeFailure(response)}`,
        kind,
        response.status,
        parseRetryAfter(response),
      );
    }

    // Deliberately NOT detached on success. fetch resolves once the headers
    // arrive, while a streaming speech body is still being read — the caller's
    // signal has to stay linked so a barge-in mid-reply still aborts that read.
    // Only the deadline is cleared, since it covers time-to-headers, not the
    // length of the audio. Callers pass a short-lived, per-request signal
    // (see plymaxx-tts.ts), so the listener dies with it.
    clearTimeout(timer);
    return response;
  };

  try {
    return await attempt();
  } catch (err) {
    const canRetry =
      retryOnBusy &&
      err instanceof PlymaxxRequestError &&
      err.retryable &&
      !signal?.aborted;
    if (!canRetry) throw err;

    // Honour Retry-After, but never stall a live turn for long.
    const waitMs = Math.min(1_500, Math.max(200, ((err as PlymaxxRequestError).retryAfterSeconds ?? 0.4) * 1_000));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    if (signal?.aborted) throw err;
    return attempt();
  }
}

/**
 * Performs a request AND reads its JSON body under one deadline.
 *
 * plymaxxFetch resolves as soon as the headers arrive, because a streaming
 * speech body legitimately outlives the timeout. A JSON caller has no such
 * excuse: if the server sends headers and then stalls mid-body, an unbounded
 * read would hang the caller's turn. The deadline is therefore re-armed across
 * the body read here, and aborting it closes the connection.
 */
export async function plymaxxFetchJson<T>(options: PlymaxxRequestOptions): Promise<T> {
  const controller = new AbortController();
  const caller = options.signal;
  const onCallerAbort = (): void => controller.abort();
  if (caller) {
    if (caller.aborted) controller.abort();
    else caller.addEventListener('abort', onCallerAbort, { once: true });
  }

  try {
    const response = await plymaxxFetch({ ...options, signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      return (await response.json()) as T;
    } catch (err) {
      if (controller.signal.aborted && !caller?.aborted) {
        throw new PlymaxxRequestError(
          `${options.adapterName}: response body stalled beyond ${options.timeoutMs}ms.`,
          'network',
          null,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  } finally {
    caller?.removeEventListener('abort', onCallerAbort);
  }
}

/** Convenience wrapper for JSON-in/JSON-out endpoints. */
export async function plymaxxJson<T>(options: Omit<PlymaxxRequestOptions, 'body' | 'jsonContentType'> & { payload: unknown }): Promise<T> {
  return plymaxxFetchJson<T>({
    ...options,
    body: JSON.stringify(options.payload),
    jsonContentType: true,
  });
}
