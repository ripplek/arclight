import { createMiddleware } from 'hono/factory';
import { auth } from '../auth/index.js';
import type { Session, User } from 'better-auth/types';

export type AuthVariables = {
  user: User & { role: string; timezone: string; locale: string };
  session: Session;
};

/**
 * Require authentication.
 * On success, injects user + session into c.var.
 * On failure, returns 401.
 */
export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('user', session.user as AuthVariables['user']);
  c.set('session', session.session);
  await next();
});

/**
 * Require admin role. Must be used after requireAuth.
 */
export const requireAdmin = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ error: 'Forbidden: admin required' }, 403);
  }
  await next();
});
