import type { PlayerState, StateSnapshotMessage } from '@shooter/shared';
import { EntityInterpolator, type InterpolatedWorld } from '../net/interpolation.ts';
import { LocalPredictor } from '../net/prediction.ts';

export class GameStore {
  interpolator = new EntityInterpolator();
  predictor = new LocalPredictor();
  localUserId: string | null = null;
  aim = 0;
  private seq = 0;
  private localPlayer: PlayerState | null = null;
  spawned = false;

  reset(): void {
    this.interpolator = new EntityInterpolator();
    this.predictor = new LocalPredictor();
    this.localUserId = null;
    this.aim = 0;
    this.seq = 0;
    this.localPlayer = null;
    this.spawned = false;
  }

  setLocalUserId(userId: string | null): void {
    this.localUserId = userId;
  }

  isLocal(player: Pick<PlayerState, 'id' | 'userId'>): boolean {
    return (
      this.localUserId !== null &&
      (player.userId === this.localUserId || player.id === this.localUserId)
    );
  }

  get localIsDead(): boolean {
    return this.localPlayer?.isDead === true;
  }

  applySnapshot(snapshot: StateSnapshotMessage, receivedAt: number): void {
    this.interpolator.push(snapshot, receivedAt);
    const local = snapshot.players.find((player) => this.isLocal(player));
    if (!local) {
      return;
    }
    this.localPlayer = local;
    if (!this.spawned) {
      this.predictor.reset({ x: local.x, y: local.y });
      this.spawned = true;
      return;
    }
    this.predictor.reconcile({ x: local.x, y: local.y, seq: local.seq });
  }

  applyLocalMove(dx: number, dy: number, t: number, dt: number): number {
    this.seq += 1;
    this.predictor.applyMove(this.seq, dx, dy, t, dt);
    return this.seq;
  }

  sample(now: number): InterpolatedWorld {
    const exclude = this.localUserId ? new Set([this.localUserId]) : undefined;
    const world = this.interpolator.sample(now, { excludePlayerIds: exclude });
    if (!this.localPlayer) {
      return world;
    }
    return {
      ...world,
      players: [
        ...world.players,
        {
          ...this.localPlayer,
          x: this.predictor.x,
          y: this.predictor.y,
          angle: this.aim,
        },
      ],
    };
  }
}

let store = new GameStore();

export function getGameStore(): GameStore {
  return store;
}

export function resetGameStore(): void {
  store.reset();
}

export type GameSubscribe = (
  type: 'state:snapshot',
  handler: (message: StateSnapshotMessage) => void,
) => () => void;

export function bindGameNet(
  subscribe: GameSubscribe,
  getLocalUserId: () => string | null,
  now: () => number = defaultNow,
): () => void {
  const game = getGameStore();
  game.setLocalUserId(getLocalUserId());
  return subscribe('state:snapshot', (message) => {
    game.setLocalUserId(getLocalUserId());
    game.applySnapshot(message, now());
  });
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
