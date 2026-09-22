import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { MonsterState, PlayerState, StateSnapshotMessage, WaveConfig } from '@shooter/shared';
import { AUTH_TOKEN_KEY, resetAuthStore, useAuthStore } from '../auth/authStore.ts';
import { resetHubStore, useHubStore } from '../hub/hubStore.ts';
import { MessageBus } from '../net/wsClient.ts';
import { createSenders } from '../net/senders.ts';
import { resetHudStore, useHudStore } from './hudStore.ts';

const waves: WaveConfig[] = [
  { startSec: 0, endSec: 30, spawns: [] },
  { startSec: 30, endSec: 70, spawns: [] },
];

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

function monster(partial: Partial<MonsterState> & Pick<MonsterState, 'id'>): MonsterState {
  return {
    type: 'melee',
    x: 0,
    y: 0,
    hp: 10,
    targetPlayerId: null,
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

const originalFetch = globalThis.fetch;

function installMemoryLocalStorage(): void {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      get length() {
        return data.size;
      },
      clear() {
        data.clear();
      },
      getItem(key: string) {
        return data.get(key) ?? null;
      },
      key(index: number) {
        return [...data.keys()][index] ?? null;
      },
      removeItem(key: string) {
        data.delete(key);
      },
      setItem(key: string, value: string) {
        data.set(key, String(value));
      },
    },
    configurable: true,
  });
}

describe('hud store', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    resetAuthStore();
    resetHubStore();
    resetHudStore();
    useAuthStore.setState({ token: 'tok', userId: 'u-local', screen: 'arena', hydrated: true });
    useHubStore.setState({ match: { seed: 1, waveConfig: waves } });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetHudStore();
    resetHubStore();
    resetAuthStore();
  });

  it('updates HP, XP, and level from snapshots in real time', () => {
    useHudStore.getState().applySnapshot(
      snapshot(1, {
        players: [player({ id: 'u-local', x: 0, y: 0, hp: 80, xp: 40, level: 1 })],
      }),
      'u-local',
      waves,
    );
    assert.equal(useHudStore.getState().hp, 80);
    assert.equal(useHudStore.getState().xp, 40);
    assert.equal(useHudStore.getState().level, 1);

    useHudStore.getState().applySnapshot(
      snapshot(2, {
        players: [player({ id: 'u-local', x: 0, y: 0, hp: 55, xp: 120, level: 2 })],
      }),
      'u-local',
      waves,
    );
    assert.equal(useHudStore.getState().hp, 55);
    assert.equal(useHudStore.getState().xp, 120);
    assert.equal(useHudStore.getState().level, 2);
  });

  it('advances the wave counter from snapshot ticks', () => {
    useHudStore.getState().applySnapshot(snapshot(1), 'u-local', waves);
    assert.equal(useHudStore.getState().wave, 1);
    useHudStore.getState().applySnapshot(snapshot(700), 'u-local', waves);
    assert.equal(useHudStore.getState().wave, 2);
  });

  it('increments kill count when monsters disappear', () => {
    useHudStore.getState().applySnapshot(
      snapshot(1, { monsters: [monster({ id: 'm1' }), monster({ id: 'm2' })] }),
      'u-local',
    );
    assert.equal(useHudStore.getState().kills, 0);
    useHudStore.getState().applySnapshot(snapshot(2, { monsters: [monster({ id: 'm2' })] }), 'u-local');
    assert.equal(useHudStore.getState().kills, 1);
    useHudStore.getState().applySnapshot(snapshot(3, { monsters: [] }), 'u-local');
    assert.equal(useHudStore.getState().kills, 2);
  });

  it('shows upgrade choices for the local player and blocks input until chosen', () => {
    const sent: string[] = [];
    const senders = createSenders({
      send(message) {
        sent.push(message.type);
      },
    });
    useHudStore.getState().bindNet(
      () => () => {},
      () => 'u-local',
      () => waves,
      () => senders,
    );

    useHudStore.getState().applyLevelUp(
      { type: 'player:levelUp', playerId: 'u-local', choices: ['move_speed', 'reload_speed', 'damage'] },
      'u-local',
    );
    assert.deepEqual(useHudStore.getState().upgradeChoices, ['move_speed', 'reload_speed', 'damage']);
    assert.equal(useHudStore.getState().inputBlocked, true);

    useHudStore.getState().chooseUpgrade('damage');
    assert.equal(sent[0], 'player:chooseUpgrade');
    assert.equal(useHudStore.getState().upgradeChoices, null);
    assert.equal(useHudStore.getState().inputBlocked, false);
  });

  it('ignores level-ups for other players', () => {
    useHudStore.getState().applyLevelUp(
      { type: 'player:levelUp', playerId: 'other', choices: ['move_speed', 'reload_speed', 'damage'] },
      'u-local',
    );
    assert.equal(useHudStore.getState().upgradeChoices, null);
  });

  it('marks spectator when the local player dies', () => {
    useHudStore.getState().applyDied('u-local', 'u-local');
    assert.equal(useHudStore.getState().spectator, true);
    useHudStore.getState().applySnapshot(
      snapshot(1, { players: [player({ id: 'u-local', x: 1, y: 1, isDead: true, hp: 0 })] }),
      'u-local',
    );
    assert.equal(useHudStore.getState().spectator, true);
  });

  it('stores run results and returns to the hub with a refreshed profile', async () => {
    let loaded: string | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      loaded = String(input);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          rank: 10,
          metaCurrency: 42,
          totalRuns: 3,
          bestWaves: 5,
          totalKills: 9,
          weaponUnlocks: [],
          weapons: [],
        }),
      } as Response;
    }) as typeof fetch;
    localStorage.setItem(AUTH_TOKEN_KEY, 'tok');

    useHudStore.getState().applyRunEnded([
      { userId: 'u-local', waves: 3, kills: 8, survivedSec: 41, metaPointsEarned: 22 },
    ]);
    assert.equal(useHudStore.getState().results?.[0]?.metaPointsEarned, 22);
    assert.equal(useHudStore.getState().inputBlocked, true);

    useHubStore.getState().returnToHub();
    assert.equal(useAuthStore.getState().screen, 'hub');
    assert.equal(useHudStore.getState().results, null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(loaded ?? '', /profile\/me/);
    assert.equal(useHubStore.getState().profile?.metaCurrency, 42);
  });

  it('bindNet applies snapshot, levelUp, died, and run:ended from the bus', () => {
    const bus = new MessageBus();
    const unbind = useHudStore.getState().bindNet(
      (type, handler) => bus.on(type, handler),
      () => 'u-local',
      () => waves,
      () => null,
    );
    bus.emit(
      snapshot(1, {
        players: [player({ id: 'u-local', x: 0, y: 0, hp: 70, xp: 15 })],
        monsters: [monster({ id: 'm1' })],
      }),
    );
    assert.equal(useHudStore.getState().hp, 70);
    bus.emit({
      type: 'player:levelUp',
      playerId: 'u-local',
      choices: ['move_speed', 'reload_speed', 'damage'],
    });
    assert.ok(useHudStore.getState().upgradeChoices);
    bus.emit({ type: 'player:died', playerId: 'u-local' });
    assert.equal(useHudStore.getState().spectator, true);
    bus.emit({
      type: 'run:ended',
      results: [{ userId: 'u-local', waves: 1, kills: 0, survivedSec: 5, metaPointsEarned: 1 }],
    });
    assert.equal(useHudStore.getState().results?.length, 1);
    unbind();
  });
});
