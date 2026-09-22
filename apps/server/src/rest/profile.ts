import { db } from '@shooter/db';
import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import weapons from '../config/weapons.json' with { type: 'json' };

export const profileRouter: ExpressRouter = Router();

class UnlockHttpError extends Error {
  constructor(readonly status: 402 | 409) {
    super();
    this.name = 'UnlockHttpError';
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002';
}

function readWeaponId(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    return '';
  }
  const value = (body as Record<string, unknown>)['weaponId'];
  return typeof value === 'string' ? value : '';
}

function findWeapon(weaponId: string) {
  return weapons.find((weapon) => weapon.id === weaponId);
}

profileRouter.get('/me', async (req, res, next) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        weaponUnlocks: { select: { id: true, weaponId: true } },
      },
    });
    if (!user?.profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    const { profile, weaponUnlocks } = user;
    res.status(200).json({
      id: profile.id,
      userId: profile.userId,
      rank: profile.rank,
      metaCurrency: profile.metaCurrency,
      totalRuns: profile.totalRuns,
      bestWaves: profile.bestWaves,
      totalKills: profile.totalKills,
      weaponUnlocks,
      weapons: weapons.map(({ id, name, damage, fireRate, xpCost, defaultUnlock }) => ({
        id,
        name,
        damage,
        fireRate,
        xpCost,
        defaultUnlock,
      })),
    });
  } catch (err) {
    next(err);
  }
});

profileRouter.post('/weapons/unlock', async (req, res, next) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const weaponId = readWeaponId(req.body);
    const weapon = findWeapon(weaponId);
    if (!weapon) {
      res.status(400).json({ error: 'Unknown weaponId' });
      return;
    }

    const profile = await db.$transaction(async (tx) => {
      const owned = await tx.weaponUnlock.findUnique({
        where: { userId_weaponId: { userId, weaponId } },
      });
      if (owned) {
        throw new UnlockHttpError(409);
      }

      const updated = await tx.playerProfile.updateMany({
        where: { userId, metaCurrency: { gte: weapon.xpCost } },
        data: { metaCurrency: { decrement: weapon.xpCost } },
      });
      if (updated.count !== 1) {
        throw new UnlockHttpError(402);
      }

      try {
        await tx.weaponUnlock.create({ data: { userId, weaponId } });
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          throw new UnlockHttpError(409);
        }
        throw err;
      }

      return tx.playerProfile.findUniqueOrThrow({ where: { userId } });
    });

    res.status(200).json({ weaponId, metaCurrency: profile.metaCurrency });
  } catch (err) {
    if (err instanceof UnlockHttpError) {
      if (err.status === 409) {
        res.status(409).json({ error: 'Weapon already owned' });
        return;
      }
      res.status(402).json({ error: 'Insufficient funds' });
      return;
    }
    next(err);
  }
});
