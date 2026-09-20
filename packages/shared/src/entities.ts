export type MonsterType = 'melee' | 'ranged' | 'swarm';

export type PickupType = 'xp_orb' | 'medkit';

export type UpgradeOptionId = 'move_speed' | 'reload_speed' | 'damage';

export interface PlayerState {
  id: string;
  userId: string;
  x: number;
  y: number;
  angle: number;
  hp: number;
  maxHp: number;
  weaponId: string;
  level: number;
  xp: number;
  isDead: boolean;
  /** Last processed `input:move` sequence number, echoed for client reconciliation. */
  seq: number;
}

export interface MonsterState {
  id: string;
  type: MonsterType;
  x: number;
  y: number;
  hp: number;
  targetPlayerId: string | null;
}

export interface ProjectileState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
}

export interface PickupState {
  id: string;
  type: PickupType;
  x: number;
  y: number;
  /** XP amount for `xp_orb`, heal amount for `medkit`. */
  value: number;
}

export interface WaveSpawn {
  type: MonsterType;
  count: number;
  hpMultiplier: number;
}

export interface WaveConfig {
  startSec: number;
  endSec: number;
  spawns: WaveSpawn[];
}

export interface RunPlayerResult {
  userId: string;
  waves: number;
  kills: number;
  survivedSec: number;
  metaPointsEarned: number;
}

export interface GroupMember {
  userId: string;
  username: string;
  isLeader: boolean;
}
