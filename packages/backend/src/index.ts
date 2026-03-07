import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import cron from 'node-cron';
import { logger } from './shared/logger.js';
import { auth } from './auth/index.js';
import { sourceRoutes } from './routes/sources.js';
import { engineRoutes } from './routes/engine.js';
import { preferencesRoutes } from './routes/preferences.js';
import { digestRoutes } from './routes/digests.js';
import { getScheduler } from './engine/scheduler.js';
import { checkAndGenerateDigests } from './scheduler/jobs/generate-digest.js';

const app = new Hono();

// Middleware
app.use('*', cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'],
  credentials: true,
}));
app.use('*', honoLogger());

// Health check
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    version: '0.2.0',
    timestamp: new Date().toISOString(),
  });
});

// Auth routes — better-auth handles /api/auth/*
app.on(['GET', 'POST'], '/api/auth/*', (c) => {
  logger.info({ rawUrl: c.req.raw.url, reqPath: c.req.path }, 'Auth handler invoked');
  return auth.handler(c.req.raw);
});

// API routes
app.route('/api/v1/sources', sourceRoutes);
app.route('/api/v1/engine', engineRoutes);
app.route('/api/v1/me/preferences', preferencesRoutes);
app.route('/api/v1/me/digests', digestRoutes);

export type AppType = typeof app;

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port }, (info) => {
  logger.info(`🚀 ArcLight running on http://localhost:${info.port}`);
});

// Start Feed Scheduler
const scheduler = getScheduler();
scheduler.start();

// Digest generation cron — every minute, check if any user digest is due
cron.schedule('* * * * *', () => {
  checkAndGenerateDigests().catch((err) => logger.error({ err }, 'Digest scheduler error'));
});

// Graceful shutdown
process.on('SIGINT', () => {
  scheduler.stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  scheduler.stop();
  process.exit(0);
});
