import type {
  MonsterState,
  PickupState,
  PlayerState,
  ProjectileState,
  StateSnapshotMessage,
} from '@shooter/shared';

export interface SnapshotFrame {
  tick: number;
  receivedAt: number;
  players: PlayerState[];
  monsters: MonsterState[];
  projectiles: ProjectileState[];
  pickups: PickupState[];
}

export interface InterpolatedWorld {
  players: PlayerState[];
  monsters: MonsterState[];
  projectiles: ProjectileState[];
  pickups: PickupState[];
}

const EMPTY_WORLD: InterpolatedWorld = {
  players: [],
  monsters: [],
  projectiles: [],
  pickups: [],
};

export class EntityInterpolator {
  private prev: SnapshotFrame | null = null;
  private next: SnapshotFrame | null = null;

  push(snapshot: StateSnapshotMessage, receivedAt: number): void {
    this.prev = this.next;
    this.next = {
      tick: snapshot.tick,
      receivedAt,
      players: snapshot.players,
      monsters: snapshot.monsters,
      projectiles: snapshot.projectiles,
      pickups: snapshot.pickups,
    };
  }

  sample(now: number, options: { excludePlayerIds?: ReadonlySet<string> } = {}): InterpolatedWorld {
    if (!this.next) {
      return EMPTY_WORLD;
    }
    if (!this.prev) {
      return filterPlayers(cloneWorld(this.next), options.excludePlayerIds);
    }

    const interval = this.next.receivedAt - this.prev.receivedAt;
    const elapsed = now - this.next.receivedAt;
    const alpha = interval <= 0 ? 1 : clamp(elapsed / interval, 0, 1);

    return {
      players: interpolatePlayers(this.prev.players, this.next.players, alpha, options.excludePlayerIds),
      monsters: interpolateById(this.prev.monsters, this.next.monsters, alpha),
      projectiles: interpolateById(this.prev.projectiles, this.next.projectiles, alpha),
      pickups: interpolateById(this.prev.pickups, this.next.pickups, alpha),
    };
  }
}

function interpolatePlayers(
  prev: PlayerState[],
  next: PlayerState[],
  alpha: number,
  excludePlayerIds?: ReadonlySet<string>,
): PlayerState[] {
  const prevMap = indexById(prev);
  const interpolated: PlayerState[] = [];
  for (const n of next) {
    if (excludePlayerIds?.has(n.id) || excludePlayerIds?.has(n.userId)) {
      continue;
    }
    const p = prevMap.get(n.id);
    if (!p) {
      interpolated.push(n);
      continue;
    }
    interpolated.push({
      ...n,
      x: lerp(p.x, n.x, alpha),
      y: lerp(p.y, n.y, alpha),
      angle: lerpAngle(p.angle, n.angle, alpha),
    });
  }
  return interpolated;
}

function interpolateById<T extends { id: string; x: number; y: number }>(
  prev: T[],
  next: T[],
  alpha: number,
): T[] {
  const prevMap = indexById(prev);
  return next.map((n) => {
    const p = prevMap.get(n.id);
    if (!p) {
      return n;
    }
    return {
      ...n,
      x: lerp(p.x, n.x, alpha),
      y: lerp(p.y, n.y, alpha),
    };
  });
}

function indexById<T extends { id: string }>(items: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(item.id, item);
  }
  return map;
}

function cloneWorld(frame: SnapshotFrame): InterpolatedWorld {
  return {
    players: frame.players,
    monsters: frame.monsters,
    projectiles: frame.projectiles,
    pickups: frame.pickups,
  };
}

function filterPlayers(
  world: InterpolatedWorld,
  excludePlayerIds?: ReadonlySet<string>,
): InterpolatedWorld {
  if (!excludePlayerIds || excludePlayerIds.size === 0) {
    return world;
  }
  return {
    ...world,
    players: world.players.filter(
      (player) => !excludePlayerIds.has(player.id) && !excludePlayerIds.has(player.userId),
    ),
  };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) {
    diff -= Math.PI * 2;
  }
  while (diff < -Math.PI) {
    diff += Math.PI * 2;
  }
  return a + diff * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
