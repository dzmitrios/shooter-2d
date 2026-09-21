import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { authRouter } from './auth.js';
import { profileRouter } from './profile.js';
import { requireAuth } from './requireAuth.js';

export function createApp(): Express {
  const app = express();

  app.use(express.json());
  app.use('/auth', authRouter);
  app.use('/profile', requireAuth, profileRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
