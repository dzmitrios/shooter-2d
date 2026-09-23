import type {
  MonsterState,
  MonsterType,
  PickupState,
  PlayerLevelUpMessage,
  PlayerState,
  ProjectileState,
  RunPlayerResult,
  ServerMessage,
  StateSnapshotMessage,
  UpgradeOptionId,
  WaveConfig,
} from '@shooter/shared';
import {
  gameConfig,
  getMonsterConfig,
  getWeapon,
  waves,
  type GameConfig,
  type WeaponDef,
} from '../config/index.js';
import { logger } from '../observability/logger.js';
import { tickDuration } from '../observability/metrics.js';
import type { PersistRun, RunPersistRecord } from './runPersistence.js';
import { WaveSpawner } from './waveSpawner.js';

export interface PermanentUpgrades {
  move_speed: number;
  reload_speed: number;
  damage: number;
}

export interface RoomPlayer {
  userId: string;
  username: string;
  weaponId: string;
  rank: number;
  permanentUpgrades?: PermanentUpgrades;
}

export interface GameInstanceOptions {
  autoStart?: boolean;
  tickMs?: number;
  now?: () => number;
  random?: () => number;
  broadcast?: (userId: string, message: ServerMessage) => void;
  persistRun?: PersistRun;
  onFinished?: (roomId: string) => void;
  config?: GameConfig;
  weapons?: WeaponDef[];
  waves?: WaveConfig[];
}

interface SimPlayer {
  state: PlayerState;
  speed: number;
  damage: number;
  reloadMs: number;
  baseDamage: number;
  baseReloadMs: number;
  upgrades: PermanentUpgrades;
  pendingUpgrades: number;
  radius: number;
  moveDx: number;
  moveDy: number;
  rank: number;
  kills: number;
  diedAtSec: number | null;
}

interface SimMonster {
  state: MonsterState;
  radius: number;
  damage: number;
  speed: number;
  lastFireAt: number;
}

interface SimProjectile {
  state: ProjectileState;
  radius: number;
}

interface SimPickup {
  state: PickupState;
  spawnedAt: number;
}

const ZERO_UPGRADES: PermanentUpgrades = {
  move_speed: 0,
  reload_speed: 0,
  damage: 0,
};

const LEVEL_UP_CHOICES: PlayerLevelUpMessage['choices'] = [
  'move_speed',
  'reload_speed',
  'damage',
];

const UPGRADE_OPTION_IDS = new Set<string>(LEVEL_UP_CHOICES);

export class GameInstance {
  readonly disconnected = new Set<string>();
  readonly upgradeDeltas: GameConfig['upgrades'];
  tickCount = 0;

  private readonly config: GameConfig;
  private readonly tickMs: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly broadcast?: (userId: string, message: ServerMessage) => void;
  private readonly persistRun?: PersistRun;
  private readonly onFinished?: (roomId: string) => void;
  private readonly waveSpawner: WaveSpawner;

  private readonly simPlayers = new Map<string, SimPlayer>();
  private readonly monsters: SimMonster[] = [];
  private readonly projectiles: SimProjectile[] = [];
  private readonly pickups: SimPickup[] = [];
  private readonly meleeHits = new Map<string, number>();
  private readonly diedBroadcast = new Set<string>();

  private nextEntityId = 1;
  private lastTickAt: number;
  private elapsedSec = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ending = false;
  private ended = false;

  constructor(
    readonly roomId: string,
    readonly players: RoomPlayer[],
    readonly seed: number,
    options: GameInstanceOptions = {},
  ) {
    this.config = options.config ?? gameConfig;
    this.upgradeDeltas = this.config.upgrades;
    this.tickMs = options.tickMs ?? this.config.combat.tickMs;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.broadcast = options.broadcast;
    this.persistRun = options.persistRun;
    this.onFinished = options.onFinished;
    this.lastTickAt = this.now();
    this.waveSpawner = new WaveSpawner(options.waves ?? waves, {
      width: this.config.arena.width,
      height: this.config.arena.height,
      inset: this.config.monsters.spawnInset,
      clusterSpread: this.config.monsters.clusterSpread,
      random: this.random,
    });

    this.initPlayers(options.weapons);
    if (options.autoStart ?? true) {
      this.start();
    }
  }

  start(): void {
    if (this.timer || this.ended) {
      return;
    }
    this.lastTickAt = this.now();
    this.timer = setInterval(() => {
      this.tick();
    }, this.tickMs);
    this.timer.unref?.();
  }

  destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  markDisconnected(userId: string): void {
    this.disconnected.add(userId);
  }

  handleMove(userId: string, dx: number, dy: number, seq: number): void {
    const player = this.simPlayers.get(userId);
    if (!player || player.state.isDead) {
      return;
    }
    const { dx: ndx, dy: ndy } = normalize(dx, dy);
    player.moveDx = ndx;
    player.moveDy = ndy;
    player.state.seq = seq;
  }

  handleShoot(userId: string, angle: number): void {
    const player = this.simPlayers.get(userId);
    if (!player || player.state.isDead) {
      return;
    }
    player.state.angle = angle;
    const speed = this.config.combat.projectileSpeed;
    this.projectiles.push({
      radius: this.config.combat.projectileRadius,
      state: {
        id: this.nextId('proj'),
        ownerId: userId,
        x: player.state.x,
        y: player.state.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        damage: player.damage,
      },
    });
    this.resolveProjectileHits();
  }

  handleChooseUpgrade(userId: string, optionId: string): void {
    const player = this.simPlayers.get(userId);
    if (!player || player.pendingUpgrades <= 0 || !UPGRADE_OPTION_IDS.has(optionId)) {
      return;
    }
    const option = optionId as UpgradeOptionId;
    player.upgrades[option] += 1;
    player.pendingUpgrades -= 1;
    this.applyCombatStats(player);
  }

  getCombatStats(userId: string): { speed: number; damage: number; reloadMs: number } | undefined {
    const player = this.simPlayers.get(userId);
    if (!player) {
      return undefined;
    }
    return { speed: player.speed, damage: player.damage, reloadMs: player.reloadMs };
  }

  spawnMonster(input: {
    type?: MonsterType;
    x: number;
    y: number;
    hp?: number;
    hpMultiplier?: number;
    targetPlayerId?: string | null;
  }): MonsterState {
    const type = input.type ?? 'melee';
    const stats = getMonsterConfig(type, this.config);
    const hp =
      input.hp ?? Math.max(1, Math.round(stats.hp * (input.hpMultiplier ?? 1)));
    const state: MonsterState = {
      id: this.nextId('mon'),
      type,
      x: input.x,
      y: input.y,
      hp,
      targetPlayerId: input.targetPlayerId ?? null,
    };
    this.monsters.push({
      state,
      radius: stats.radius,
      damage: stats.damage,
      speed: stats.speed,
      lastFireAt: Number.NEGATIVE_INFINITY,
    });
    return state;
  }

  getPlayer(userId: string): PlayerState | undefined {
    const player = this.simPlayers.get(userId);
    return player ? clonePlayer(player.state) : undefined;
  }

  getSnapshot(): StateSnapshotMessage {
    return {
      type: 'state:snapshot',
      tick: this.tickCount,
      players: [...this.simPlayers.values()].map((player) => clonePlayer(player.state)),
      monsters: this.monsters.map((monster) => ({ ...monster.state })),
      projectiles: this.projectiles.map((projectile) => ({ ...projectile.state })),
      pickups: this.pickups.map((pickup) => ({ ...pickup.state })),
    };
  }

  tick(): void {
    const stop = tickDuration.startTimer();
    try {
      this.runTick();
    } finally {
      stop();
    }
  }

  private runTick(): void {
    if (this.ended || this.ending) {
      return;
    }

    const now = this.now();
    const dt = Math.min(Math.max((now - this.lastTickAt) / 1000, 0), 0.1);
    this.lastTickAt = now;
    this.elapsedSec += dt;
    this.tickCount += 1;

    this.spawnScheduledWaves();
    this.stepPlayers(dt);
    this.stepMonsters(dt, now);
    this.stepProjectiles(dt);
    this.resolveProjectileHits();
    this.resolveContactHits(now);
    this.processDeaths();
    this.resolvePickupCollisions();
    this.despawnPickups(now);
    this.dispatchSnapshot();

    if (this.allPlayersDead()) {
      void this.finalizeRun();
    }
  }

  private initPlayers(weaponOverrides?: WeaponDef[]): void {
    const { width, height } = this.config.arena;
    const count = Math.max(this.players.length, 1);

    this.players.forEach((player, index) => {
      const angle = (2 * Math.PI * index) / count;
      const x = width / 2 + Math.cos(angle) * 80;
      const y = height / 2 + Math.sin(angle) * 80;
      const upgrades = { ...ZERO_UPGRADES, ...player.permanentUpgrades };
      const weapon =
        weaponOverrides?.find((item) => item.id === player.weaponId) ??
        getWeapon(player.weaponId);
      const simPlayer: SimPlayer = {
        state: {
          id: player.userId,
          userId: player.userId,
          x,
          y,
          angle: 0,
          hp: this.config.player.baseHp,
          maxHp: this.config.player.baseMaxHp,
          weaponId: player.weaponId,
          level: 1,
          xp: 0,
          isDead: false,
          seq: 0,
        },
        speed: this.config.player.baseSpeed,
        damage: weapon?.damage ?? 10,
        reloadMs: 1000 / Math.max(weapon?.fireRate ?? 1, 0.01),
        baseDamage: weapon?.damage ?? 10,
        baseReloadMs: 1000 / Math.max(weapon?.fireRate ?? 1, 0.01),
        upgrades,
        pendingUpgrades: 0,
        radius: this.config.player.radius,
        moveDx: 0,
        moveDy: 0,
        rank: player.rank,
        kills: 0,
        diedAtSec: null,
      };
      this.applyCombatStats(simPlayer);
      this.simPlayers.set(player.userId, simPlayer);
    });
  }

  private applyCombatStats(player: SimPlayer): void {
    player.speed =
      this.config.player.baseSpeed +
      this.upgradeDeltas.move_speed.delta * player.upgrades.move_speed;
    player.damage =
      player.baseDamage * (1 + this.upgradeDeltas.damage.delta * player.upgrades.damage);
    player.reloadMs =
      player.baseReloadMs *
      Math.max(0.1, 1 - this.upgradeDeltas.reload_speed.delta * player.upgrades.reload_speed);
  }

  private stepPlayers(dt: number): void {
    const { width, height } = this.config.arena;
    for (const player of this.simPlayers.values()) {
      if (player.state.isDead) {
        continue;
      }
      player.state.x += player.moveDx * player.speed * dt;
      player.state.y += player.moveDy * player.speed * dt;
      player.state.x = clamp(player.state.x, player.radius, width - player.radius);
      player.state.y = clamp(player.state.y, player.radius, height - player.radius);
    }
  }

  private spawnScheduledWaves(): void {
    for (const spawn of this.waveSpawner.collectSpawns(this.elapsedSec)) {
      this.spawnMonster({
        type: spawn.type,
        x: spawn.x,
        y: spawn.y,
        hpMultiplier: spawn.hpMultiplier,
      });
    }
  }

  private stepMonsters(dt: number, now: number): void {
    for (const monster of this.monsters) {
      const target = this.nearestLivingPlayer(monster.state.x, monster.state.y);
      monster.state.targetPlayerId = target?.state.id ?? null;
      if (!target) {
        continue;
      }
      if (monster.state.type === 'ranged') {
        this.stepRangedMonster(monster, target, dt, now);
      } else {
        this.seekTarget(monster, target.state.x, target.state.y, dt);
      }
    }
  }

  private stepRangedMonster(
    monster: SimMonster,
    target: SimPlayer,
    dt: number,
    now: number,
  ): void {
    const ranged = this.config.monsters.ranged;
    const dx = target.state.x - monster.state.x;
    const dy = target.state.y - monster.state.y;
    const dist = Math.hypot(dx, dy);
    if (dist < ranged.minRange) {
      this.seekTarget(monster, monster.state.x - dx, monster.state.y - dy, dt);
    } else if (dist > ranged.maxRange) {
      this.seekTarget(monster, target.state.x, target.state.y, dt);
    }

    if (dist <= ranged.fireRange && now - monster.lastFireAt >= ranged.fireCooldownMs) {
      monster.lastFireAt = now;
      const aim = dist === 0 ? { dx: 1, dy: 0 } : { dx: dx / dist, dy: dy / dist };
      this.projectiles.push({
        radius: ranged.projectileRadius,
        state: {
          id: this.nextId('proj'),
          ownerId: monster.state.id,
          x: monster.state.x,
          y: monster.state.y,
          vx: aim.dx * ranged.projectileSpeed,
          vy: aim.dy * ranged.projectileSpeed,
          damage: monster.damage,
        },
      });
    }
  }

  private seekTarget(monster: SimMonster, x: number, y: number, dt: number): void {
    const { dx, dy } = normalize(x - monster.state.x, y - monster.state.y);
    const { width, height } = this.config.arena;
    monster.state.x += dx * monster.speed * dt;
    monster.state.y += dy * monster.speed * dt;
    monster.state.x = clamp(monster.state.x, monster.radius, width - monster.radius);
    monster.state.y = clamp(monster.state.y, monster.radius, height - monster.radius);
  }

  private nearestLivingPlayer(x: number, y: number): SimPlayer | undefined {
    let nearest: SimPlayer | undefined;
    let nearestDist = Number.POSITIVE_INFINITY;
    for (const player of this.simPlayers.values()) {
      if (player.state.isDead) {
        continue;
      }
      const dist = Math.hypot(player.state.x - x, player.state.y - y);
      if (dist < nearestDist) {
        nearest = player;
        nearestDist = dist;
      }
    }
    return nearest;
  }

  private stepProjectiles(dt: number): void {
    const { width, height } = this.config.arena;
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = this.projectiles[i];
      if (!projectile) {
        continue;
      }
      projectile.state.x += projectile.state.vx * dt;
      projectile.state.y += projectile.state.vy * dt;
      if (
        projectile.state.x < 0 ||
        projectile.state.x > width ||
        projectile.state.y < 0 ||
        projectile.state.y > height
      ) {
        this.projectiles.splice(i, 1);
      }
    }
  }

  private resolveProjectileHits(): void {
    for (let p = this.projectiles.length - 1; p >= 0; p -= 1) {
      const projectile = this.projectiles[p];
      if (!projectile) {
        continue;
      }
      if (this.simPlayers.has(projectile.state.ownerId)) {
        this.hitMonsters(projectile, p);
      } else {
        this.hitPlayers(projectile, p);
      }
    }
  }

  private hitMonsters(projectile: SimProjectile, projectileIndex: number): boolean {
    for (let m = this.monsters.length - 1; m >= 0; m -= 1) {
      const monster = this.monsters[m];
      if (!monster) {
        continue;
      }
      if (
        !circlesOverlap(
          projectile.state.x,
          projectile.state.y,
          projectile.radius,
          monster.state.x,
          monster.state.y,
          monster.radius,
        )
      ) {
        continue;
      }
      monster.state.hp -= projectile.state.damage;
      this.projectiles.splice(projectileIndex, 1);
      if (monster.state.hp <= 0) {
        const owner = this.simPlayers.get(projectile.state.ownerId);
        if (owner) {
          owner.kills += 1;
        }
        this.spawnMonsterDrops(monster.state);
        this.monsters.splice(m, 1);
      }
      return true;
    }
    return false;
  }

  private hitPlayers(projectile: SimProjectile, projectileIndex: number): boolean {
    for (const player of this.simPlayers.values()) {
      if (player.state.isDead) {
        continue;
      }
      if (
        !circlesOverlap(
          projectile.state.x,
          projectile.state.y,
          projectile.radius,
          player.state.x,
          player.state.y,
          player.radius,
        )
      ) {
        continue;
      }
      player.state.hp -= projectile.state.damage;
      this.projectiles.splice(projectileIndex, 1);
      return true;
    }
    return false;
  }

  private resolveContactHits(now: number): void {
    const cooldown = this.config.combat.meleeCooldownMs;
    for (const monster of this.monsters) {
      if (monster.state.type === 'ranged') {
        continue;
      }
      for (const player of this.simPlayers.values()) {
        if (player.state.isDead) {
          continue;
        }
        if (
          !circlesOverlap(
            monster.state.x,
            monster.state.y,
            monster.radius,
            player.state.x,
            player.state.y,
            player.radius,
          )
        ) {
          continue;
        }
        const key = `${monster.state.id}:${player.state.id}`;
        const lastHit = this.meleeHits.get(key) ?? Number.NEGATIVE_INFINITY;
        if (now - lastHit < cooldown) {
          continue;
        }
        this.meleeHits.set(key, now);
        player.state.hp -= monster.damage;
      }
    }
  }

  private processDeaths(): void {
    for (const player of this.simPlayers.values()) {
      if (player.state.isDead || player.state.hp > 0) {
        continue;
      }
      player.state.hp = 0;
      player.state.isDead = true;
      player.diedAtSec = this.elapsedSec;
      player.moveDx = 0;
      player.moveDy = 0;
      this.spawnPickup('xp_orb', player.state.x, player.state.y, this.config.combat.playerDeathXp);
      if (!this.diedBroadcast.has(player.state.id)) {
        this.diedBroadcast.add(player.state.id);
        this.broadcastAll({ type: 'player:died', playerId: player.state.id });
      }
    }
  }

  private spawnMonsterDrops(monster: MonsterState): void {
    const xp = getMonsterConfig(monster.type, this.config).xp;
    this.spawnPickup('xp_orb', monster.x, monster.y, xp);
    if (this.random() < this.config.combat.medkitDropChance) {
      this.spawnPickup('medkit', monster.x, monster.y, this.config.combat.medkitHeal);
    }
  }

  private spawnPickup(type: PickupState['type'], x: number, y: number, value: number): void {
    this.pickups.push({
      spawnedAt: this.now(),
      state: {
        id: this.nextId('pk'),
        type,
        x,
        y,
        value,
      },
    });
  }

  private resolvePickupCollisions(): void {
    const pickupRadius = this.config.combat.pickupRadius;
    for (let i = this.pickups.length - 1; i >= 0; i -= 1) {
      const pickup = this.pickups[i];
      if (!pickup) {
        continue;
      }
      for (const player of this.simPlayers.values()) {
        if (player.state.isDead) {
          continue;
        }
        if (
          !circlesOverlap(
            pickup.state.x,
            pickup.state.y,
            pickupRadius,
            player.state.x,
            player.state.y,
            player.radius,
          )
        ) {
          continue;
        }
        this.applyPickup(player, pickup.state);
        this.pickups.splice(i, 1);
        break;
      }
    }
  }

  private applyPickup(player: SimPlayer, pickup: PickupState): void {
    if (pickup.type === 'xp_orb') {
      player.state.xp += pickup.value;
      this.checkLevelUp(player);
      return;
    }
    player.state.hp = Math.min(player.state.maxHp, player.state.hp + pickup.value);
  }

  private checkLevelUp(player: SimPlayer): void {
    const curve = this.config.xpCurve;
    while (player.state.level < curve.length) {
      const threshold = curve[player.state.level];
      if (threshold === undefined || player.state.xp < threshold) {
        break;
      }
      player.state.level += 1;
      player.pendingUpgrades += 1;
      this.broadcastAll({
        type: 'player:levelUp',
        playerId: player.state.id,
        choices: LEVEL_UP_CHOICES,
      });
    }
  }

  private despawnPickups(now: number): void {
    const timeout = this.config.combat.pickupDespawnMs;
    for (let i = this.pickups.length - 1; i >= 0; i -= 1) {
      const pickup = this.pickups[i];
      if (!pickup) {
        continue;
      }
      if (now - pickup.spawnedAt >= timeout) {
        this.pickups.splice(i, 1);
      }
    }
  }

  private dispatchSnapshot(): void {
    this.broadcastAll(this.getSnapshot());
  }

  private broadcastAll(message: ServerMessage): void {
    if (!this.broadcast) {
      return;
    }
    for (const player of this.players) {
      this.broadcast(player.userId, message);
    }
  }

  private allPlayersDead(): boolean {
    if (this.simPlayers.size === 0) {
      return false;
    }
    for (const player of this.simPlayers.values()) {
      if (!player.state.isDead) {
        return false;
      }
    }
    return true;
  }

  private async finalizeRun(): Promise<void> {
    if (this.ending) {
      return;
    }
    this.ending = true;
    this.destroy();

    const records = this.buildRunRecords();
    const results: RunPlayerResult[] = records.map((record) => ({
      userId: record.userId,
      waves: record.wavesSurvived,
      kills: record.kills,
      survivedSec: record.survivedSec,
      metaPointsEarned: record.metaPointsEarned,
    }));

    this.broadcastAll({ type: 'run:ended', results });

    try {
      await this.persistRun?.(this.roomId, records);
    } catch (err) {
      logger.error({ err }, 'failed to persist run');
    }

    this.ended = true;
    this.onFinished?.(this.roomId);
  }

  private buildRunRecords(): RunPersistRecord[] {
    const wavesByPlayer = [...this.simPlayers.values()].map((player) =>
      this.wavesSurvived(player.diedAtSec ?? this.elapsedSec),
    );
    const averageWaves =
      wavesByPlayer.length === 0
        ? 0
        : wavesByPlayer.reduce((sum, value) => sum + value, 0) / wavesByPlayer.length;

    return [...this.simPlayers.values()].map((player) => {
      const wavesSurvived = this.wavesSurvived(player.diedAtSec ?? this.elapsedSec);
      const survivedSec = player.diedAtSec ?? this.elapsedSec;
      const rankBefore = player.rank;
      const delta =
        wavesSurvived >= averageWaves ? this.config.rank.winDelta : this.config.rank.lossDelta;
      const rankAfter = Math.max(0, rankBefore + delta);
      const metaPointsEarned = Math.max(
        0,
        Math.floor(
          wavesSurvived * this.config.metaPoints.perWave +
            player.kills * this.config.metaPoints.perKill +
            survivedSec * this.config.metaPoints.perSecond,
        ),
      );
      return {
        userId: player.state.userId,
        wavesSurvived,
        kills: player.kills,
        survivedSec,
        metaPointsEarned,
        rankBefore,
        rankAfter,
      };
    });
  }

  private wavesSurvived(elapsedSec: number): number {
    let count = 0;
    for (const wave of waves) {
      if (elapsedSec >= wave.startSec) {
        count += 1;
      }
    }
    return count;
  }

  private nextId(prefix: string): string {
    const id = this.nextEntityId;
    this.nextEntityId += 1;
    return `${prefix}-${id}`;
  }
}

function normalize(dx: number, dy: number): { dx: number; dy: number } {
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return { dx: 0, dy: 0 };
  }
  return { dx: dx / length, dy: dy / length };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function circlesOverlap(
  x1: number,
  y1: number,
  r1: number,
  x2: number,
  y2: number,
  r2: number,
): boolean {
  const dx = x1 - x2;
  const dy = y1 - y2;
  const r = r1 + r2;
  return dx * dx + dy * dy <= r * r;
}

function clonePlayer(state: PlayerState): PlayerState {
  return { ...state };
}
