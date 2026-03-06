import { Hono } from 'hono';
import { auth } from './index.js';

const authApp = new Hono();

// better-auth handles all /api/auth/* routes
authApp.on(['GET', 'POST'], '/**', (c) => {
  return auth.handler(c.req.raw);
});

export { authApp };
