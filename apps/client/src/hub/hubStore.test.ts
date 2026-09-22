import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { ClientMessage, ServerMessage } from '@shooter/shared';
import { AUTH_TOKEN_KEY, resetAuthStore, useAuthStore } from '../auth/authStore.ts';
import { MessageBus } from '../net/wsClient.ts';
import { createSenders } from '../net/senders.ts';
import { MATCH_FOUND_DURATION_MS, resetHubStore, useHubStore } from './hubStore.ts';

const originalFetch = globalThis.fetch;

const catalog = [
  { id: 'pistol', name: 'Pistol', xpCost: 0, defaultUnlock: true },
  { id: 'shotgun', name: 'Shotgun', xpCost: 0, defaultUnlock: true },
  { id: 'smg', name: 'SMG', xpCost: 300, defaultUnlock: false },
];

function profileBody(overrides: Record<string, unknown> = {}) {
  return {
    rank: 4,
    metaCurrency: 250,
    totalRuns: 2,
    bestWaves: 6,
    totalKills: 11,
    weaponUnlocks: [
      { id: 'u1', weaponId: 'pistol' },
      { id: 'u2', weaponId: 'shotgun' },
    ],
    weapons: catalog,
    ...overrides,
  };
}

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const result = handler(String(input), init);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.body,
    } as Response;
  }) as typeof fetch;
}

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

describe('hub store', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    resetAuthStore();
    resetHubStore();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetHubStore();
  });

  it('loads profile stats and selects the first unlocked weapon by default', async () => {
    mockFetch(() => ({ status: 200, body: profileBody() }));
    await useHubStore.getState().loadProfile('tok');
    const state = useHubStore.getState();
    assert.equal(state.profile?.rank, 4);
    assert.equal(state.profile?.metaCurrency, 250);
    assert.equal(state.profile?.totalRuns, 2);
    assert.equal(state.profile?.bestWaves, 6);
    assert.equal(state.profile?.totalKills, 11);
    assert.equal(state.selectedWeaponId, 'pistol');
  });

  it('keeps the current selection when it is still owned after refresh', async () => {
    mockFetch(() => ({ status: 200, body: profileBody() }));
    await useHubStore.getState().loadProfile('tok');
    useHubStore.getState().selectWeapon('shotgun');
    await useHubStore.getState().loadProfile('tok');
    assert.equal(useHubStore.getState().selectedWeaponId, 'shotgun');
  });

  it('does not select locked weapons', async () => {
    mockFetch(() => ({ status: 200, body: profileBody() }));
    await useHubStore.getState().loadProfile('tok');
    useHubStore.getState().selectWeapon('smg');
    assert.equal(useHubStore.getState().selectedWeaponId, 'pistol');
  });

  it('buys a weapon, refreshes unlocks, and surfaces 402 / 409 errors', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'tok');
    useAuthStore.setState({ token: 'tok', userId: 'u', screen: 'hub', hydrated: true });

    let unlocks = [
      { id: 'u1', weaponId: 'pistol' },
      { id: 'u2', weaponId: 'shotgun' },
    ];
    mockFetch((url, init) => {
      if (url.endsWith('/profile/weapons/unlock') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { weaponId: string };
        if (body.weaponId === 'smg') {
          unlocks = [...unlocks, { id: 'u3', weaponId: 'smg' }];
          return { status: 200, body: { weaponId: 'smg', metaCurrency: 0 } };
        }
        if (body.weaponId === 'rifle') {
          return { status: 402, body: { error: 'Insufficient funds' } };
        }
        return { status: 409, body: { error: 'Weapon already owned' } };
      }
      return { status: 200, body: profileBody({ weaponUnlocks: unlocks, metaCurrency: 0 }) };
    });

    await useHubStore.getState().loadProfile('tok');
    await useHubStore.getState().buyWeapon('smg');
    assert.equal(useHubStore.getState().shopError, null);
    assert.ok(useHubStore.getState().profile?.weaponUnlocks.some((row) => row.weaponId === 'smg'));

    await useHubStore.getState().buyWeapon('rifle');
    assert.equal(useHubStore.getState().shopError, 'Insufficient funds');

    await useHubStore.getState().buyWeapon('pistol');
    assert.equal(useHubStore.getState().shopError, 'Weapon already owned');
  });

  it('tracks group state and GROUP_FULL / GROUP_NOT_FOUND errors', () => {
    const bus = new MessageBus();
    const sent: ClientMessage[] = [];
    useHubStore.getState().bindNet(createSenders({ send: (message) => sent.push(message) }), (type, handler) =>
      bus.on(type, handler),
    );

    useHubStore.getState().createGroup();
    assert.deepEqual(sent[0], { type: 'group:create' });

    bus.emit({
      type: 'group:state',
      groupId: 'g1',
      groupCode: 'ABC123',
      members: [
        { userId: 'u1', username: 'Ada', isLeader: true },
        { userId: 'u2', username: 'Bob', isLeader: false },
      ],
    } satisfies ServerMessage);

    assert.equal(useHubStore.getState().group?.groupCode, 'ABC123');
    assert.equal(useHubStore.getState().group?.members.length, 2);

    useHubStore.getState().joinGroup('nope');
    assert.deepEqual(sent[1], { type: 'group:join', groupCode: 'nope' });

    bus.emit({ type: 'error', code: 'GROUP_NOT_FOUND' });
    assert.equal(useHubStore.getState().groupError, 'GROUP_NOT_FOUND');
    bus.emit({ type: 'error', code: 'GROUP_FULL' });
    assert.equal(useHubStore.getState().groupError, 'GROUP_FULL');
  });

  it('queues with weaponId and groupId, shows queue status, and WEAPON_NOT_OWNED', () => {
    const bus = new MessageBus();
    const sent: ClientMessage[] = [];
    useHubStore.getState().bindNet(createSenders({ send: (message) => sent.push(message) }), (type, handler) =>
      bus.on(type, handler),
    );

    useHubStore.getState().startQueue();
    assert.equal(useHubStore.getState().queueError, 'WEAPON_NOT_OWNED');
    assert.equal(sent.length, 0);

    useHubStore.setState({
      selectedWeaponId: 'pistol',
      group: { groupId: 'g1', groupCode: 'ABC123', members: [] },
      queueError: null,
    });
    useHubStore.getState().startQueue();
    assert.equal(useHubStore.getState().queueStatus, 'joining');
    assert.deepEqual(sent[0], { type: 'queue:join', weaponId: 'pistol', groupId: 'g1' });

    bus.emit({ type: 'queue:status' });
    assert.equal(useHubStore.getState().queueStatus, 'finding');

    bus.emit({ type: 'error', code: 'WEAPON_NOT_OWNED' });
    assert.equal(useHubStore.getState().queueError, 'WEAPON_NOT_OWNED');
    assert.equal(useHubStore.getState().queueStatus, 'idle');
  });

  it('navigates every recipient to the arena on the same run:started tick', () => {
    assert.ok(MATCH_FOUND_DURATION_MS >= 500 && MATCH_FOUND_DURATION_MS <= 1000);

    const bus = new MessageBus();
    useHubStore.getState().bindNet(createSenders({ send: () => {} }), (type, handler) =>
      bus.on(type, handler),
    );

    const started = {
      type: 'run:started',
      seed: 42,
      waveConfig: [{ startSec: 0, endSec: 30, spawns: [{ type: 'melee' as const, count: 3, hpMultiplier: 1 }] }],
    } satisfies ServerMessage;

    const arrivals: Array<{ screen: string; overlay: boolean }> = [];
    const second = new MessageBus();
    second.on('run:started', (message) => {
      useHubStore.getState().beginMatch(message.seed, message.waveConfig);
      arrivals.push({
        screen: useAuthStore.getState().screen,
        overlay: useHubStore.getState().matchFoundVisible,
      });
    });

    bus.on('run:started', () => {
      arrivals.push({
        screen: useAuthStore.getState().screen,
        overlay: useHubStore.getState().matchFoundVisible,
      });
    });

    bus.emit(started);
    second.emit(started);

    assert.equal(useAuthStore.getState().screen, 'arena');
    assert.equal(useHubStore.getState().matchFoundVisible, true);
    assert.equal(useHubStore.getState().match?.seed, 42);
    assert.equal(arrivals.length, 2);
    assert.deepEqual(arrivals[0], { screen: 'arena', overlay: true });
    assert.deepEqual(arrivals[1], { screen: 'arena', overlay: true });
  });

  it('hides Match found overlay after the configured delay', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    useHubStore.getState().beginMatch(7, []);
    assert.equal(useHubStore.getState().matchFoundVisible, true);
    t.mock.timers.tick(MATCH_FOUND_DURATION_MS);
    assert.equal(useHubStore.getState().matchFoundVisible, false);
  });
});
