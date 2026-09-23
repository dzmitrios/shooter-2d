import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { logger } from '../observability/logger.js';
import { metricsContentType, renderMetrics } from '../observability/metrics.js';
import { reportError } from '../observability/sentry.js';
import { authRouter } from './auth.js';
import { profileRouter } from './profile.js';
import { requireAuth } from './requireAuth.js';

export interface CreateAppOptions {
  extraRoutes?: (app: Express) => void;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  app.use(express.json());
  app.use('/auth', authRouter);
  app.use('/profile', requireAuth, profileRouter);
  options.extraRoutes?.(app);
  app.get('/metrics', async (_req, res) => {
    const body = await renderMetrics();
    res.writeHead(200, { 'Content-Type': metricsContentType() });
    res.end(body);
  });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, 'request failed');
    reportError(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
