import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { logger } from './shared/logger.js';
import { authApp } from './auth/handler.js';
import { sourceRoutes } from './routes/sources.js';

const app = new Hono();

// Middleware
app.use('*', cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));
app.use('*', honoLogger());

// Health check
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

// Auth routes — better-auth handles /api/auth/*
app.route('/api/auth', authApp);

// API routes
app.route('/api/v1/sources', sourceRoutes);

export type AppType = typeof app;

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port }, (info) => {
  logger.info(`🚀 ArcLight running on http://localhost:${info.port}`);
});
