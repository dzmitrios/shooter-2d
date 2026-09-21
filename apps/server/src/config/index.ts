import type { MonsterType, WaveConfig } from '@shooter/shared';
import gameJson from './game.json' with { type: 'json' };
import weaponsJson from './weapons.json' with { type: 'json' };
import wavesJson from './waves.json' with { type: 'json' };

export interface UpgradeStep {
  delta: number;
  description: string;
}

export interface ContactMonsterConfig {
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  xp: number;
}

export interface RangedMonsterConfig extends ContactMonsterConfig {
  minRange: number;
  maxRange: number;
  fireRange: number;
  fireCooldownMs: number;
  projectileSpeed: number;
  projectileRadius: number;
}

export interface MonstersConfig {
  melee: ContactMonsterConfig;
  ranged: RangedMonsterConfig;
  swarm: ContactMonsterConfig;
  spawnInset: number;
  clusterSpread: number;
}

export interface GameConfig {
  upgrades: {
    move_speed: UpgradeStep;
    reload_speed: UpgradeStep;
    damage: UpgradeStep;
  };
  rank: {
    winDelta: number;
    lossDelta: number;
    description: string;
  };
  arena: {
    width: number;
    height: number;
  };
  player: {
    baseSpeed: number;
    baseHp: number;
    baseMaxHp: number;
    radius: number;
  };
  combat: {
    tickMs: number;
    projectileSpeed: number;
    projectileRadius: number;
    monsterRadius: number;
    meleeDamage: number;
    meleeCooldownMs: number;
    medkitDropChance: number;
    medkitHeal: number;
    playerDeathXp: number;
    pickupRadius: number;
    pickupDespawnMs: number;
  };
  monsters: MonstersConfig;
  metaPoints: {
    perWave: number;
    perKill: number;
    perSecond: number;
  };
  xpCurve: number[];
}

export interface WeaponDef {
  id: string;
  name: string;
  damage: number;
  fireRate: number;
  xpCost: number;
  defaultUnlock: boolean;
}

export const gameConfig: GameConfig = gameJson;
export const weapons: WeaponDef[] = weaponsJson;
export const waves: WaveConfig[] = wavesJson as WaveConfig[];

export function getWeapon(weaponId: string): WeaponDef | undefined {
  return weapons.find((weapon) => weapon.id === weaponId);
}

export function getMonsterConfig(
  type: MonsterType,
  config: GameConfig = gameConfig,
): ContactMonsterConfig | RangedMonsterConfig {
  return config.monsters[type];
}
