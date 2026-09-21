import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  MonsterState,
  PickupState,
  PlayerState,
  ProjectileState,
  StateSnapshotMessage,
} from '@shooter/shared';
import { EntityInterpolator } from './interpolation.ts';

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

describe('EntityInterpolator', () => {
  it('returns the first snapshot until a second one arrives', () => {
    const interpolator = new EntityInterpolator();
    interpolator.push(
      snapshot(1, { players: [player({ id: 'a', x: 0, y: 0 })] }),
      0,
    );
    const sampled = interpolator.sample(10);
    assert.equal(sampled.players[0]?.x, 0);
  });

  it('lerps remote entities between consecutive snapshots', () => {
    const interpolator = new EntityInterpolator();
    interpolator.push(
      snapshot(1, {
        players: [player({ id: 'remote', userId: 'u-remote', x: 0, y: 0 })],
        monsters: [monster({ id: 'm1', x: 0, y: 10 })],
        projectiles: [projectile({ id: 'b1', x: 0, y: 20 })],
        pickups: [pickup({ id: 'o1', x: 0, y: 30 })],
      }),
      0,
    );
    interpolator.push(
      snapshot(2, {
        players: [player({ id: 'remote', userId: 'u-remote', x: 10, y: 0 })],
        monsters: [monster({ id: 'm1', x: 10, y: 10 })],
        projectiles: [projectile({ id: 'b1', x: 10, y: 20 })],
        pickups: [pickup({ id: 'o1', x: 10, y: 30 })],
      }),
      50,
    );

    const mid = interpolator.sample(75);
    assert.equal(mid.players[0]?.x, 5);
    assert.equal(mid.monsters[0]?.x, 5);
    assert.equal(mid.projectiles[0]?.x, 5);
    assert.equal(mid.pickups[0]?.x, 5);

    const end = interpolator.sample(100);
    assert.equal(end.players[0]?.x, 10);
    assert.equal(end.monsters[0]?.x, 10);
  });

  it('skips the local player so prediction can own that position', () => {
    const interpolator = new EntityInterpolator();
    interpolator.push(
      snapshot(1, {
        players: [
          player({ id: 'local', userId: 'u-local', x: 0, y: 0 }),
          player({ id: 'remote', userId: 'u-remote', x: 0, y: 0 }),
        ],
      }),
      0,
    );
    interpolator.push(
      snapshot(2, {
        players: [
          player({ id: 'local', userId: 'u-local', x: 10, y: 0 }),
          player({ id: 'remote', userId: 'u-remote', x: 10, y: 0 }),
        ],
      }),
      50,
    );

    const sampled = interpolator.sample(75, { excludePlayerIds: new Set(['u-local']) });
    assert.equal(sampled.players.length, 1);
    assert.equal(sampled.players[0]?.id, 'remote');
    assert.equal(sampled.players[0]?.x, 5);
  });
});
