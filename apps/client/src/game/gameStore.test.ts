import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { PlayerState, StateSnapshotMessage } from '@shooter/shared';
import { DEFAULT_PREDICTION_CONFIG } from '../net/prediction.ts';
import { MessageBus } from '../net/wsClient.ts';
import { GameStore, bindGameNet, getGameStore, resetGameStore } from './gameStore.ts';

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

describe('GameStore', () => {
  beforeEach(() => {
    resetGameStore();
  });

  afterEach(() => {
    resetGameStore();
  });

  it('predicts the local player and interpolates remotes from snapshots', () => {
    const store = new GameStore();
    store.setLocalUserId('u-local');
    store.applySnapshot(
      snapshot(1, {
        players: [
          player({ id: 'local', userId: 'u-local', x: 100, y: 200 }),
          player({ id: 'remote', userId: 'u-remote', x: 0, y: 0 }),
        ],
      }),
      0,
    );
    store.applySnapshot(
      snapshot(2, {
        players: [
          player({ id: 'local', userId: 'u-local', x: 100, y: 200, seq: 0 }),
          player({ id: 'remote', userId: 'u-remote', x: 10, y: 0 }),
        ],
      }),
      50,
    );

    store.applyLocalMove(1, 0, 60, 0.05);
    const world = store.sample(75);
    const local = world.players.find((p) => p.userId === 'u-local');
    const remote = world.players.find((p) => p.userId === 'u-remote');
    assert.ok(local);
    assert.ok(remote);
    assert.equal(local.x, 100 + DEFAULT_PREDICTION_CONFIG.speed * 0.05);
    assert.equal(local.y, 200);
    assert.equal(remote.x, 5);
  });

  it('clamps predicted local movement to the arena', () => {
    const store = new GameStore();
    store.setLocalUserId('u-local');
    store.applySnapshot(
      snapshot(1, { players: [player({ id: 'local', userId: 'u-local', x: 2380, y: 800 })] }),
      0,
    );
    store.applyLocalMove(1, 0, 10, 5);
    const world = store.sample(10);
    assert.equal(world.players[0]?.x, 2400 - 16);
  });

  it('bindGameNet applies snapshots from the message bus', () => {
    const bus = new MessageBus();
    getGameStore().setLocalUserId('u1');
    const unbind = bindGameNet(
      (type, handler) => bus.on(type, handler),
      () => 'u1',
      () => 10,
    );
    bus.emit(
      snapshot(1, { players: [player({ id: 'p1', userId: 'u1', x: 40, y: 50 })] }),
    );
    assert.equal(getGameStore().spawned, true);
    assert.equal(getGameStore().predictor.x, 40);
    unbind();
  });
});
