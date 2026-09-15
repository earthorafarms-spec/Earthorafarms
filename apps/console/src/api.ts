export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: 'include', ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) },
    body: json !== undefined ? JSON.stringify(json) : (rest.body as any),
  });
  const text = await res.text();
  let payload: any = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { error: text }; }
  if (!res.ok) throw new ApiError(res.status, payload?.error || res.statusText);
  return payload as T;
}

export interface StaffUser { id: string; email: string; name: string; roles: string[] }
export const auth = {
  me: () => api<{ user: StaffUser | null }>('/auth/me'),
  login: (email: string, password: string) => api<{ challengeId: string; otpEmailHint: string; devOtp?: string }>('/auth/login', { method: 'POST', json: { email, password } }),
  verify: (challengeId: string, otp: string) => api<{ user: StaffUser }>('/auth/verify', { method: 'POST', json: { challengeId, otp } }),
  logout: () => api('/auth/logout', { method: 'POST' }),
};
