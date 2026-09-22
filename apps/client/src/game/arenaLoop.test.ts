import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type {
  MonsterState,
  PickupState,
  PlayerState,
  ProjectileState,
  StateSnapshotMessage,
} from '@shooter/shared';
import type { ClientMessage } from '@shooter/shared';
import { createSenders } from '../net/senders.ts';
import { FollowCamera } from './camera.ts';
import { ARENA_HEIGHT, ARENA_WIDTH, LOCAL_PLAYER_COLOR, MONSTER_STYLE, PICKUP_STYLE } from './constants.ts';
import { GameStore } from './gameStore.ts';
import { resetHudStore, useHudStore } from './hudStore.ts';
import { InputController } from './input.ts';
import { stepArena } from './arenaLoop.ts';
import { buildWorldView } from './worldView.ts';

function player(partial: Partial<PlayerState> & Pick<PlayerState, 'id' | 'x' | 'y'>): PlayerState {
  return {
    userId: partial.userId ?? partial.id,
    angle: 0,
    hp: 100,
    maxHp: 100,
    weaponId: 'pistol',
    level: 1,
    xp: 0,
    isDead: false,
    seq: 0,
    ...partial,
  };
}

function monster(partial: Partial<MonsterState> & Pick<MonsterState, 'id' | 'x' | 'y'>): MonsterState {
  return {
    type: 'melee',
    hp: 40,
    targetPlayerId: null,
    ...partial,
  };
}

function projectile(
  partial: Partial<ProjectileState> & Pick<ProjectileState, 'id' | 'x' | 'y'>,
): ProjectileState {
  return {
    ownerId: 'p1',
    vx: 10,
    vy: 0,
    damage: 5,
    ...partial,
  };
}

function pickup(partial: Partial<PickupState> & Pick<PickupState, 'id' | 'x' | 'y'>): PickupState {
  return {
    type: 'xp_orb',
    value: 10,
    ...partial,
  };
}

function snapshot(
  tick: number,
  extra: Partial<StateSnapshotMessage> = {},
): StateSnapshotMessage {
  return {
    type: 'state:snapshot',
    tick,
    players: [],
    monsters: [],
    projectiles: [],
    pickups: [],
    ...extra,
  };
}

describe('arena world view', () => {
  it('renders players as coloured circles with aim indicators', () => {
    const view = buildWorldView(
      {
        players: [
          player({ id: 'local', userId: 'u-local', x: 100, y: 120, angle: 0.5 }),
          player({ id: 'remote', userId: 'u-remote', x: 200, y: 220, angle: 1 }),
        ],
        monsters: [],
        projectiles: [],
        pickups: [],
      },
      'u-local',
    );
    assert.equal(view.players.length, 2);
    assert.equal(view.players[0]?.local, true);
    assert.equal(view.players[0]?.color, LOCAL_PLAYER_COLOR);
    assert.ok((view.players[0]?.aimLength ?? 0) > 0);
    assert.equal(view.players[0]?.radius, 16);
    assert.equal(view.players[1]?.local, false);
    assert.equal(typeof view.players[1]?.color, 'number');
  });

  it('uses a distinct shape and colour per monster archetype', () => {
    const view = buildWorldView(
      {
        players: [],
        monsters: [
          monster({ id: 'm1', type: 'melee', x: 1, y: 1 }),
          monster({ id: 'm2', type: 'ranged', x: 2, y: 2 }),
          monster({ id: 'm3', type: 'swarm', x: 3, y: 3 }),
        ],
        projectiles: [],
        pickups: [],
      },
      null,
    );
    const byType = Object.fromEntries(view.monsters.map((m) => [m.type, m]));
    assert.equal(byType.melee?.shape, MONSTER_STYLE.melee.shape);
    assert.equal(byType.ranged?.shape, MONSTER_STYLE.ranged.shape);
    assert.equal(byType.swarm?.shape, MONSTER_STYLE.swarm.shape);
    assert.notEqual(byType.melee?.color, byType.ranged?.color);
    assert.notEqual(byType.ranged?.color, byType.swarm?.color);
  });

  it('draws projectile trails opposite velocity and drops collected pickups', () => {
    const withItems = buildWorldView(
      {
        players: [],
        monsters: [],
        projectiles: [projectile({ id: 'b1', x: 50, y: 10, vx: 20, vy: 0 })],
        pickups: [
          pickup({ id: 'xp1', type: 'xp_orb', x: 8, y: 8 }),
          pickup({ id: 'med1', type: 'medkit', x: 9, y: 9 }),
        ],
      },
      null,
    );
    assert.equal(withItems.projectiles.length, 1);
    assert.ok((withItems.projectiles[0]?.trailX ?? 0) < 50);
    assert.equal(withItems.projectiles[0]?.trailY, 10);
    assert.equal(withItems.pickups[0]?.color, PICKUP_STYLE.xp_orb.color);
    assert.equal(withItems.pickups[1]?.color, PICKUP_STYLE.medkit.color);

    const afterCollect = buildWorldView(
      { players: [], monsters: [], projectiles: [], pickups: [] },
      null,
    );
    assert.equal(afterCollect.projectiles.length, 0);
    assert.equal(afterCollect.pickups.length, 0);
  });

  it('includes a rectangular arena border matching simulation bounds', () => {
    const view = buildWorldView(
      { players: [], monsters: [], projectiles: [], pickups: [] },
      null,
    );
    assert.deepEqual(view.bounds, { x: 0, y: 0, width: ARENA_WIDTH, height: ARENA_HEIGHT });
  });
});

describe('arena loop', () => {
  const sent: ClientMessage[] = [];
  const senders = createSenders({
    send(message) {
      sent.push(message);
    },
  });

  beforeEach(() => {
    sent.length = 0;
    resetHudStore();
  });

  afterEach(() => {
    sent.length = 0;
    resetHudStore();
  });

  it('sends WASD move every frame and shoot on click or space', () => {
    const store = new GameStore();
    store.setLocalUserId('u-local');
    store.applySnapshot(
      snapshot(1, { players: [player({ id: 'local', userId: 'u-local', x: 400, y: 400 })] }),
      0,
    );
    const input = new InputController();
    input.pressKey('KeyD');
    input.setPointer(500, 400, true);
    const camera = new FollowCamera();

    const frame = stepArena({
      store,
      input,
      camera,
      senders,
      now: 16,
      dt: 0.016,
      viewWidth: 800,
      viewHeight: 600,
    });

    const move = sent.find((m) => m.type === 'input:move');
    const shoot = sent.find((m) => m.type === 'input:shoot');
    assert.ok(move && move.type === 'input:move');
    assert.equal(move.dx, 1);
    assert.equal(move.dy, 0);
    assert.ok(shoot && shoot.type === 'input:shoot');
    assert.equal(typeof shoot.angle, 'number');
    assert.equal(frame.world.players[0]?.x, store.predictor.x);

    sent.length = 0;
    input.pointerDown = false;
    input.releaseKey('KeyD');
    input.pressKey('Space');
    stepArena({
      store,
      input,
      camera,
      senders,
      now: 32,
      dt: 0.016,
      viewWidth: 800,
      viewHeight: 600,
    });
    assert.ok(sent.some((m) => m.type === 'input:shoot'));
  });

  it('blocks move and shoot while an upgrade choice is pending', () => {
    useHudStore.setState({
      upgradeChoices: ['move_speed', 'reload_speed', 'damage'],
      pendingUpgrades: 1,
      inputBlocked: true,
    });
    const store = new GameStore();
    store.setLocalUserId('u-local');
    store.applySnapshot(
      snapshot(1, { players: [player({ id: 'local', userId: 'u-local', x: 400, y: 400 })] }),
      0,
    );
    const input = new InputController();
    input.pressKey('KeyD');
    input.setPointer(500, 400, true);
    stepArena({
      store,
      input,
      camera: new FollowCamera(),
      senders,
      now: 16,
      dt: 0.016,
      viewWidth: 800,
      viewHeight: 600,
    });
    assert.equal(sent.length, 0);
  });

  it('centres the camera on the local player and follows smoothly', () => {
    const store = new GameStore();
    store.setLocalUserId('u-local');
    store.applySnapshot(
      snapshot(1, { players: [player({ id: 'local', userId: 'u-local', x: 400, y: 300 })] }),
      0,
    );
    const camera = new FollowCamera();
    const input = new InputController();
    const first = stepArena({
      store,
      input,
      camera,
      senders: null,
      now: 0,
      dt: 0.016,
      viewWidth: 800,
      viewHeight: 600,
    });
    assert.equal(first.cameraX, 400 - 400);
    assert.equal(first.cameraY, 300 - 300);

    store.predictor.x = 500;
    store.predictor.y = 360;
    const next = stepArena({
      store,
      input,
      camera,
      senders: null,
      now: 16,
      dt: 0.016,
      viewWidth: 800,
      viewHeight: 600,
    });
    assert.ok(next.cameraX > 0 && next.cameraX < 100);
    assert.ok(next.cameraY > 0 && next.cameraY < 60);
  });
});

describe('FollowCamera', () => {
  it('converts screen pointer position into world space', () => {
    const camera = new FollowCamera();
    camera.snapTo(400, 300, 800, 600);
    const world = camera.screenToWorld(400, 300);
    assert.equal(world.x, 400);
    assert.equal(world.y, 300);
  });
});

describe('InputController', () => {
  it('maps WASD to a movement vector', () => {
    const input = new InputController();
    input.pressKey('KeyW');
    input.pressKey('KeyA');
    assert.deepEqual(input.moveVector(), { dx: -1, dy: -1 });
    input.releaseKey('KeyA');
    assert.deepEqual(input.moveVector(), { dx: 0, dy: -1 });
  });
});
