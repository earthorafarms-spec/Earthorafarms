export class HttpError extends Error {
  constructor(public statusCode: number, message: string, public code = 'error', public details?: unknown) {
    super(message);
  }
}

export const badRequest = (m: string, details?: unknown) => new HttpError(400, m, 'bad_request', details);
export const unauthorized = (m = 'Unauthorized') => new HttpError(401, m, 'unauthorized');
export const forbidden = (m = 'Forbidden') => new HttpError(403, m, 'forbidden');
export const notFound = (m = 'Not found') => new HttpError(404, m, 'not_found');
export const conflict = (m: string) => new HttpError(409, m, 'conflict');
export const tooMany = (m = 'Too many requests') => new HttpError(429, m, 'rate_limited');
export const upstream = (m: string) => new HttpError(502, m, 'upstream');
