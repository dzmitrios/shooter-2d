import type { InterpolatedWorld } from '../net/interpolation.ts';
import type { ClientSenders } from '../net/senders.ts';
import type { FollowCamera } from './camera.ts';
import type { GameStore } from './gameStore.ts';
import { useHudStore } from './hudStore.ts';
import type { InputController } from './input.ts';
import { buildWorldView, type WorldView } from './worldView.ts';

export interface ArenaStepContext {
  store: GameStore;
  input: InputController;
  camera: FollowCamera;
  senders: ClientSenders | null;
  now: number;
  dt: number;
  viewWidth: number;
  viewHeight: number;
}

export interface ArenaFrame {
  world: InterpolatedWorld;
  view: WorldView;
  cameraX: number;
  cameraY: number;
}

export function stepArena(ctx: ArenaStepContext): ArenaFrame {
  const { store, input, camera, senders, now, dt, viewWidth, viewHeight } = ctx;
  const inputBlocked = useHudStore.getState().inputBlocked;

  if (store.spawned && !store.localIsDead && !inputBlocked) {
    const { dx, dy } = input.moveVector();
    const seq = store.applyLocalMove(dx, dy, now, dt);
    senders?.inputMove(dx, dy, seq, now);

    const mouse = camera.screenToWorld(input.pointerX, input.pointerY);
    store.aim = Math.atan2(mouse.y - store.predictor.y, mouse.x - store.predictor.x);
    if (input.isFiring()) {
      senders?.inputShoot(store.aim, now);
    }
  }

  const world = store.sample(now);
  const local = world.players.find((player) => store.isLocal(player));
  if (local) {
    camera.follow(local.x, local.y, viewWidth, viewHeight, dt);
  }

  return {
    world,
    view: buildWorldView(world, store.localUserId),
    cameraX: camera.x,
    cameraY: camera.y,
  };
}
