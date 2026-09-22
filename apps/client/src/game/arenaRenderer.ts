import { Application, Container, Graphics } from 'pixi.js';
import { useHubStore } from '../hub/hubStore.ts';
import { stepArena } from './arenaLoop.ts';
import { FollowCamera } from './camera.ts';
import {
  ARENA_BORDER,
  ARENA_BORDER_WIDTH,
  ARENA_FILL,
  ARENA_HEIGHT,
  ARENA_WIDTH,
} from './constants.ts';
import { getGameStore } from './gameStore.ts';
import { InputController } from './input.ts';
import type {
  MonsterDrawable,
  PickupDrawable,
  PlayerDrawable,
  ProjectileDrawable,
} from './worldView.ts';

export interface ArenaRendererHandle {
  destroy(): void;
}

export async function mountArenaRenderer(host: HTMLElement): Promise<ArenaRendererHandle> {
  const app = new Application();
  await app.init({
    background: 0x0a1016,
    antialias: true,
    autoDensity: true,
    resizeTo: host,
    resolution: globalThis.devicePixelRatio || 1,
  });

  const canvas = app.canvas;
  canvas.dataset.arenaCanvas = 'true';
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  host.appendChild(canvas);

  const world = new Container();
  app.stage.addChild(world);

  const bounds = new Graphics();
  bounds
    .rect(0, 0, ARENA_WIDTH, ARENA_HEIGHT)
    .fill(ARENA_FILL)
    .rect(0, 0, ARENA_WIDTH, ARENA_HEIGHT)
    .stroke({ width: ARENA_BORDER_WIDTH, color: ARENA_BORDER });
  world.addChild(bounds);

  const pickupLayer = new Container();
  const monsterLayer = new Container();
  const projectileLayer = new Container();
  const playerLayer = new Container();
  world.addChild(pickupLayer, monsterLayer, projectileLayer, playerLayer);

  const store = getGameStore();
  const camera = new FollowCamera();
  const input = new InputController();
  const detachInput = input.attach(window, canvas);

  const players = new Map<string, Graphics>();
  const monsters = new Map<string, Graphics>();
  const projectiles = new Map<string, Graphics>();
  const pickups = new Map<string, Graphics>();

  const onTick = () => {
    const frame = stepArena({
      store,
      input,
      camera,
      senders: useHubStore.getState().senders,
      now: performance.now(),
      dt: app.ticker.deltaMS / 1000,
      viewWidth: app.screen.width,
      viewHeight: app.screen.height,
    });
    world.position.set(-frame.cameraX, -frame.cameraY);
    sync(playerLayer, players, frame.view.players, drawPlayer);
    sync(monsterLayer, monsters, frame.view.monsters, drawMonster);
    sync(projectileLayer, projectiles, frame.view.projectiles, drawProjectile);
    sync(pickupLayer, pickups, frame.view.pickups, drawPickup);
  };

  app.ticker.add(onTick);

  return {
    destroy() {
      app.ticker.remove(onTick);
      detachInput();
      app.destroy(true, { children: true });
    },
  };
}

function sync<T extends { id: string }>(
  layer: Container,
  pool: Map<string, Graphics>,
  items: T[],
  draw: (graphic: Graphics, item: T) => void,
): void {
  const seen = new Set<string>();
  for (const item of items) {
    seen.add(item.id);
    let graphic = pool.get(item.id);
    if (!graphic) {
      graphic = new Graphics();
      pool.set(item.id, graphic);
      layer.addChild(graphic);
    }
    draw(graphic, item);
  }
  for (const [id, graphic] of pool) {
    if (!seen.has(id)) {
      pool.delete(id);
      graphic.destroy();
    }
  }
}

function drawPlayer(graphic: Graphics, player: PlayerDrawable): void {
  graphic.clear();
  graphic.circle(0, 0, player.radius).fill(player.color);
  if (player.local) {
    graphic.circle(0, 0, player.radius + 3).stroke({ width: 2, color: 0xffffff, alpha: 0.85 });
  }
  graphic.moveTo(0, 0).lineTo(player.aimLength, 0).stroke({ width: 3, color: 0xffffff, cap: 'round' });
  graphic.position.set(player.x, player.y);
  graphic.rotation = player.angle;
}

function drawMonster(graphic: Graphics, monster: MonsterDrawable): void {
  graphic.clear();
  const { radius, color } = monster;
  if (monster.shape === 'triangle') {
    graphic
      .poly([0, -radius, radius * 0.9, radius * 0.7, -radius * 0.9, radius * 0.7])
      .fill(color);
  } else if (monster.shape === 'square') {
    graphic.rect(-radius, -radius, radius * 2, radius * 2).fill(color);
  } else {
    graphic.circle(0, 0, radius).fill(color);
  }
  graphic.position.set(monster.x, monster.y);
  graphic.rotation = 0;
}

function drawProjectile(graphic: Graphics, projectile: ProjectileDrawable): void {
  graphic.clear();
  graphic
    .moveTo(projectile.trailX - projectile.x, projectile.trailY - projectile.y)
    .lineTo(0, 0)
    .stroke({ width: 2, color: 0xffe08a, alpha: 0.85 })
    .circle(0, 0, projectile.radius)
    .fill(0xfff1a8);
  graphic.position.set(projectile.x, projectile.y);
}

function drawPickup(graphic: Graphics, pickup: PickupDrawable): void {
  graphic.clear();
  graphic.circle(0, 0, pickup.radius).fill(pickup.color);
  if (pickup.shape === 'cross') {
    const arm = pickup.radius * 0.55;
    const thickness = 3;
    graphic.rect(-thickness / 2, -arm, thickness, arm * 2).fill(0xffffff);
    graphic.rect(-arm, -thickness / 2, arm * 2, thickness).fill(0xffffff);
  }
  graphic.position.set(pickup.x, pickup.y);
}
