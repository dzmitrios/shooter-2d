import { db } from '@shooter/db';

export interface RunPersistRecord {
  userId: string;
  wavesSurvived: number;
  kills: number;
  survivedSec: number;
  metaPointsEarned: number;
  rankBefore: number;
  rankAfter: number;
}

export type PersistRun = (roomId: string, records: RunPersistRecord[]) => Promise<void>;

export async function persistRunToDb(
  roomId: string,
  records: RunPersistRecord[],
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.room.update({
      where: { id: roomId },
      data: { status: 'FINISHED' },
    });

    for (const record of records) {
      await tx.runResult.create({
        data: {
          roomId,
          userId: record.userId,
          wavesSurvived: record.wavesSurvived,
          kills: record.kills,
          survivedSec: record.survivedSec,
          metaPointsEarned: record.metaPointsEarned,
          rankBefore: record.rankBefore,
          rankAfter: record.rankAfter,
        },
      });

      const profile = await tx.playerProfile.findUnique({ where: { userId: record.userId } });
      if (!profile) {
        continue;
      }

      await tx.playerProfile.update({
        where: { userId: record.userId },
        data: {
          rank: record.rankAfter,
          metaCurrency: { increment: record.metaPointsEarned },
          totalRuns: { increment: 1 },
          bestWaves: Math.max(profile.bestWaves, record.wavesSurvived),
          totalKills: { increment: record.kills },
        },
      });
    }
  });
}
