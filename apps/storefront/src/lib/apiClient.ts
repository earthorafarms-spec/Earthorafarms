/** Thin fetch wrapper for the owned Earthora API (same-origin /api in production, VITE_API_URL in dev). */
export const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'error', public details?: unknown) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  let payload: any = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { error: text }; }
  if (!res.ok) throw new ApiError(res.status, payload?.error || res.statusText || 'Request failed', payload?.code, payload?.details);
  return payload as T;
}

export interface StaffUser { id: string; email: string; name: string; roles: string[]; status: string }

export const authApi = {
  me: () => api<{ user: StaffUser | null }>('/api/auth/me'),
  login: (email: string, password: string) => api<{ challengeId: string; otpEmailHint: string; devOtp?: string }>('/api/auth/login', { method: 'POST', json: { email, password } }),
  verify: (challengeId: string, otp: string) => api<{ user: StaffUser }>('/api/auth/verify', { method: 'POST', json: { challengeId, otp } }),
  logout: () => api<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) => api<{ ok: true }>('/api/auth/password', { method: 'POST', json: { currentPassword, newPassword } }),
};

export function hasRole(user: StaffUser | null, ...roles: string[]): boolean {
  if (!user) return false;
  if (user.roles.includes('owner')) return true;
  return roles.some((r) => user.roles.includes(r));
}
