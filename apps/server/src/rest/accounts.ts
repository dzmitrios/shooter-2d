import { db } from '@shooter/db';
import weapons from '../config/weapons.json' with { type: 'json' };

const defaultWeaponIds = weapons
  .filter((weapon) => weapon.defaultUnlock)
  .map((weapon) => weapon.id);

export async function createAccount(input: {
  username: string;
  passwordHash?: string | null;
  isGuest: boolean;
}) {
  return db.user.create({
    data: {
      username: input.username,
      passwordHash: input.passwordHash ?? null,
      isGuest: input.isGuest,
      profile: { create: {} },
      weaponUnlocks: {
        create: defaultWeaponIds.map((weaponId) => ({ weaponId })),
      },
    },
  });
}
