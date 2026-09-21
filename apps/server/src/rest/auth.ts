import { db } from '@shooter/db';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { createAccount } from './accounts.js';
import { signToken } from './jwt.js';

export const authRouter: ExpressRouter = Router();

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002';
}

function readCredential(body: unknown, field: 'username' | 'password'): string {
  if (typeof body !== 'object' || body === null) {
    return '';
  }
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
}

authRouter.post('/guest', async (_req, res, next) => {
  try {
    const user = await createAccount({
      username: `guest_${randomUUID()}`,
      isGuest: true,
    });
    res.status(200).json({ token: signToken(user.id), userId: user.id });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/register', async (req, res, next) => {
  try {
    const username = readCredential(req.body, 'username').trim();
    const password = readCredential(req.body, 'password');
    if (!username || !password) {
      res.status(400).json({ error: 'username and password are required' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await createAccount({
      username,
      passwordHash,
      isGuest: false,
    });
    res.status(201).json({ token: signToken(user.id), userId: user.id });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      res.status(409).json({ error: 'username is taken' });
      return;
    }
    next(err);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const username = readCredential(req.body, 'username');
    const password = readCredential(req.body, 'password');
    const user = await db.user.findUnique({ where: { username } });
    if (!user?.passwordHash) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    res.status(200).json({ token: signToken(user.id), userId: user.id });
  } catch (err) {
    next(err);
  }
});
