import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { db } from '@shooter/db';
import { persistRunToDb } from './runPersistence.js';

const hasDb = Boolean(process.env['DATABASE_URL']);

describe('persistRunToDb', { skip: !hasDb }, () => {
  it('writes RunResult rows and updates PlayerProfile stats and rank', async () => {
    const userId = randomUUID();
    const username = `persist-${userId.slice(0, 8)}`;

    const user = await db.user.create({
      data: {
        id: userId,
        username,
        isGuest: true,
        profile: {
          create: { rank: 40, metaCurrency: 5, totalRuns: 1, bestWaves: 2, totalKills: 3 },
        },
      },
    });
    const room = await db.room.create({
      data: { maxPlayers: 10, status: 'IN_RUN' },
    });

    try {
      await persistRunToDb(room.id, [
        {
          userId: user.id,
          wavesSurvived: 4,
          kills: 7,
          survivedSec: 12.5,
          metaPointsEarned: 11,
          rankBefore: 40,
          rankAfter: 65,
        },
      ]);

      const result = await db.runResult.findFirst({ where: { roomId: room.id, userId: user.id } });
      assert.ok(result);
      assert.equal(result.wavesSurvived, 4);
      assert.equal(result.kills, 7);
      assert.equal(result.survivedSec, 12.5);
      assert.equal(result.metaPointsEarned, 11);
      assert.equal(result.rankBefore, 40);
      assert.equal(result.rankAfter, 65);

      const profile = await db.playerProfile.findUniqueOrThrow({ where: { userId: user.id } });
      assert.equal(profile.rank, 65);
      assert.equal(profile.metaCurrency, 16);
      assert.equal(profile.totalRuns, 2);
      assert.equal(profile.bestWaves, 4);
      assert.equal(profile.totalKills, 10);

      const finished = await db.room.findUniqueOrThrow({ where: { id: room.id } });
      assert.equal(finished.status, 'FINISHED');
      assert.equal('xp' in result, false);
      assert.equal('level' in result, false);
      assert.equal('xp' in profile, false);
      assert.equal('level' in profile, false);
    } finally {
      await db.runResult.deleteMany({ where: { roomId: room.id } });
      await db.room.delete({ where: { id: room.id } });
      await db.user.delete({ where: { id: user.id } });
    }
  });
});
