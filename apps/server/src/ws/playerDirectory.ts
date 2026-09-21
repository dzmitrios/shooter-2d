import { db } from '@shooter/db';

export interface PlayerDirectory {
  getUsername(userId: string): Promise<string>;
  getRank(userId: string): Promise<number>;
  ownsWeapon(userId: string, weaponId: string): Promise<boolean>;
  defaultWeaponId(userId: string): Promise<string | null>;
}

export class MemoryPlayerDirectory implements PlayerDirectory {
  constructor(
    readonly users = new Map<
      string,
      { username: string; rank: number; weapons: Set<string> }
    >(),
  ) {}

  seed(
    userId: string,
    info: { username: string; rank?: number; weapons?: string[] },
  ): void {
    this.users.set(userId, {
      username: info.username,
      rank: info.rank ?? 0,
      weapons: new Set(info.weapons ?? ['pistol']),
    });
  }

  async getUsername(userId: string): Promise<string> {
    return this.users.get(userId)?.username ?? `user_${userId.slice(0, 8)}`;
  }

  async getRank(userId: string): Promise<number> {
    return this.users.get(userId)?.rank ?? 0;
  }

  async ownsWeapon(userId: string, weaponId: string): Promise<boolean> {
    return this.users.get(userId)?.weapons.has(weaponId) ?? false;
  }

  async defaultWeaponId(userId: string): Promise<string | null> {
    const weapons = this.users.get(userId)?.weapons;
    if (!weapons) {
      return null;
    }
    return weapons.values().next().value ?? null;
  }
}

export const prismaPlayerDirectory: PlayerDirectory = {
  async getUsername(userId: string) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    return user?.username ?? `user_${userId.slice(0, 8)}`;
  },

  async getRank(userId: string) {
    const profile = await db.playerProfile.findUnique({
      where: { userId },
      select: { rank: true },
    });
    return profile?.rank ?? 0;
  },

  async ownsWeapon(userId: string, weaponId: string) {
    const row = await db.weaponUnlock.findUnique({
      where: { userId_weaponId: { userId, weaponId } },
    });
    return row !== null;
  },

  async defaultWeaponId(userId: string) {
    const row = await db.weaponUnlock.findFirst({ where: { userId } });
    return row?.weaponId ?? null;
  },
};
