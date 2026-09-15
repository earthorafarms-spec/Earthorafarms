import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config, isProd } from '../../config.js';
import { forbidden, unauthorized } from '../../lib/errors.js';
import { hasRole, resolveSession, type Role, type StaffUser } from './service.js';

export const SESSION_COOKIE = 'earthora_staff';

declare module 'fastify' {
  interface FastifyRequest { staff: StaffUser | null }
  interface FastifyInstance {
    requireStaff: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp(async (app) => {
  app.decorateRequest('staff', null);
  app.addHook('onRequest', async (req) => {
    const raw = req.cookies?.[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    req.staff = await resolveSession(unsigned.value);
  });
  app.decorate('requireStaff', (...roles: Role[]) => async (req: FastifyRequest) => {
    if (!req.staff) throw unauthorized('Sign in required');
    if (roles.length && !hasRole(req.staff, ...roles)) throw forbidden('Your role cannot do this');
  });
});

export function sessionCookieOptions(expiresAt: Date) {
  return { path: '/', httpOnly: true, secure: isProd, sameSite: 'lax' as const, signed: true, expires: expiresAt, maxAge: Math.floor((expiresAt.getTime() - Date.now()) / 1000) };
}

export const cookieSecret = config.COOKIE_SECRET;
