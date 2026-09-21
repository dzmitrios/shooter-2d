import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from './jwt.js';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const payload = verifyToken(header.slice('Bearer '.length));
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
