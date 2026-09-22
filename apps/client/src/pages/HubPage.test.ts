import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AUTH_TOKEN_KEY, resetAuthStore, useAuthStore } from '../auth/authStore.ts';
import { resetHubStore, useHubStore } from '../hub/hubStore.ts';
import { HubPage } from './HubPage.tsx';

const originalFetch = globalThis.fetch;

const weapons = [
  { id: 'pistol', name: 'Pistol', xpCost: 0, defaultUnlock: true },
  { id: 'smg', name: 'SMG', xpCost: 300, defaultUnlock: false },
];

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

describe('HubPage', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    resetAuthStore();
    resetHubStore();
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          rank: 7,
          metaCurrency: 90,
          totalRuns: 4,
          bestWaves: 8,
          totalKills: 30,
          weaponUnlocks: [{ id: 'u1', weaponId: 'pistol' }],
          weapons,
        }),
      }) as Response) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetHubStore();
  });

  it('renders profile stats from GET /profile/me', async () => {
    useAuthStore.setState({ token: 'tok', userId: 'u', screen: 'hub', hydrated: true });
    localStorage.setItem(AUTH_TOKEN_KEY, 'tok');
    await useHubStore.getState().loadProfile('tok');

    const html = renderToStaticMarkup(createElement(HubPage));
    assert.match(html, />Hub</);
    assert.match(html, />Rank</);
    assert.match(html, />7</);
    assert.match(html, />Meta currency</);
    assert.match(html, />90</);
    assert.match(html, />Total runs</);
    assert.match(html, />4</);
    assert.match(html, />Best waves</);
    assert.match(html, />8</);
    assert.match(html, />Total kills</);
    assert.match(html, />30</);
  });

  it('renders a merged weapon shop with a selected owned card and buyable locked cards', async () => {
    await useHubStore.getState().loadProfile('tok');
    const html = renderToStaticMarkup(createElement(HubPage));
    assert.match(html, /data-weapon-id="pistol"[^>]*weapon-card owned selected/);
    assert.match(html, />Selected</);
    assert.match(html, /data-weapon-id="smg"[^>]*weapon-card locked/);
    assert.match(html, /Cost: 300/);
    assert.match(html, />Buy</);
  });

  it('renders group controls, group code, members, and Start', () => {
    useHubStore.setState({
      loadedToken: 'tok',
      group: {
        groupId: 'g1',
        groupCode: 'XYZ789',
        members: [
          { userId: 'u1', username: 'Ada', isLeader: true },
          { userId: 'u2', username: 'Bob', isLeader: false },
        ],
      },
      queueStatus: 'finding',
      groupError: 'GROUP_NOT_FOUND',
      queueError: 'WEAPON_NOT_OWNED',
    });

    const html = renderToStaticMarkup(createElement(HubPage));
    assert.match(html, />Create Group</);
    assert.match(html, />Join Group</);
    assert.match(html, /XYZ789/);
    assert.match(html, /Ada \(leader\)/);
    assert.match(html, /Bob/);
    assert.match(html, /GROUP_NOT_FOUND/);
    assert.match(html, />Start</);
    assert.match(html, /Finding match…/);
    assert.match(html, /WEAPON_NOT_OWNED/);
  });
});
