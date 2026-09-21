import type {
  MonsterState,
  MonsterType,
  PickupState,
  PlayerState,
  ProjectileState,
  RunPlayerResult,
  ServerMessage,
  StateSnapshotMessage,
} from '@shooter/shared';
import {
  gameConfig,
  getWeapon,
  waves,
  type GameConfig,
  type WeaponDef,
} from '../config/index.js';
import type { PersistRun, RunPersistRecord } from './runPersistence.js';

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
}

interface SimPlayer {
  state: PlayerState;
  speed: number;
  damage: number;
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
}

interface SimProjectile {
  state: ProjectileState;
  radius: number;
}

const ZERO_UPGRADES: PermanentUpgrades = {
  move_speed: 0,
  reload_speed: 0,
  damage: 0,
};

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

  private readonly simPlayers = new Map<string, SimPlayer>();
  private readonly monsters: SimMonster[] = [];
  private readonly projectiles: SimProjectile[] = [];
  private readonly pickups: PickupState[] = [];
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

  spawnMonster(input: {
    type?: MonsterType;
    x: number;
    y: number;
    hp?: number;
    targetPlayerId?: string | null;
  }): MonsterState {
    const state: MonsterState = {
      id: this.nextId('mon'),
      type: input.type ?? 'melee',
      x: input.x,
      y: input.y,
      hp: input.hp ?? 30,
      targetPlayerId: input.targetPlayerId ?? null,
    };
    this.monsters.push({
      state,
      radius: this.config.combat.monsterRadius,
      damage: this.config.combat.meleeDamage,
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
      pickups: this.pickups.map((pickup) => ({ ...pickup })),
    };
  }

  tick(): void {
    if (this.ended || this.ending) {
      return;
    }

    const now = this.now();
    const dt = Math.min(Math.max((now - this.lastTickAt) / 1000, 0), 0.1);
    this.lastTickAt = now;
    this.elapsedSec += dt;
    this.tickCount += 1;

    this.stepPlayers(dt);
    this.stepProjectiles(dt);
    this.resolveProjectileHits();
    this.resolveMeleeHits(now);
    this.processDeaths();
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
      const baseDamage = weapon?.damage ?? 10;
      const speed =
        this.config.player.baseSpeed + this.upgradeDeltas.move_speed.delta * upgrades.move_speed;
      const damage = baseDamage * (1 + this.upgradeDeltas.damage.delta * upgrades.damage);

      this.simPlayers.set(player.userId, {
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
        speed,
        damage,
        radius: this.config.player.radius,
        moveDx: 0,
        moveDy: 0,
        rank: player.rank,
        kills: 0,
        diedAtSec: null,
      });
    });
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
      let hit = false;
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
        this.projectiles.splice(p, 1);
        hit = true;
        if (monster.state.hp <= 0) {
          const owner = this.simPlayers.get(projectile.state.ownerId);
          if (owner) {
            owner.kills += 1;
          }
          this.spawnMonsterDrops(monster.state.x, monster.state.y);
          this.monsters.splice(m, 1);
        }
        break;
      }
      if (hit) {
        continue;
      }
    }
  }

  private resolveMeleeHits(now: number): void {
    const cooldown = this.config.combat.meleeCooldownMs;
    for (const monster of this.monsters) {
      if (monster.state.type !== 'melee') {
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

  private spawnMonsterDrops(x: number, y: number): void {
    this.spawnPickup('xp_orb', x, y, this.config.combat.monsterXp);
    if (this.random() < this.config.combat.medkitDropChance) {
      this.spawnPickup('medkit', x, y, this.config.combat.medkitHeal);
    }
  }

  private spawnPickup(type: PickupState['type'], x: number, y: number, value: number): void {
    this.pickups.push({
      id: this.nextId('pk'),
      type,
      x,
      y,
      value,
    });
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
      console.error('failed to persist run', err);
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
