import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { fetchProfile, ProfileApiError, unlockWeapon } from './profileApi.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('profile API', () => {
  it('GETs /profile/me with the bearer token', async () => {
    let url = '';
    let auth = '';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      auth = String(init?.headers && (init.headers as Record<string, string>).Authorization);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          rank: 12,
          metaCurrency: 40,
          totalRuns: 3,
          bestWaves: 5,
          totalKills: 20,
          weaponUnlocks: [{ id: 'u1', weaponId: 'pistol' }],
          weapons: [{ id: 'pistol', name: 'Pistol', xpCost: 0, defaultUnlock: true }],
        }),
      } as Response;
    }) as typeof fetch;

    const profile = await fetchProfile('tok');
    assert.equal(url, '/profile/me');
    assert.equal(auth, 'Bearer tok');
    assert.equal(profile.rank, 12);
    assert.equal(profile.metaCurrency, 40);
    assert.equal(profile.totalRuns, 3);
    assert.equal(profile.bestWaves, 5);
    assert.equal(profile.totalKills, 20);
  });

  it('POSTs /profile/weapons/unlock and maps 402 / 409 errors', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 402,
        json: async () => ({ error: 'Insufficient funds' }),
      }) as Response) as typeof fetch;

    await assert.rejects(() => unlockWeapon('tok', 'smg'), (err: unknown) => {
      assert.ok(err instanceof ProfileApiError);
      assert.equal(err.status, 402);
      assert.equal(err.message, 'Insufficient funds');
      return true;
    });

    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 409,
        json: async () => ({ error: 'Weapon already owned' }),
      }) as Response) as typeof fetch;

    await assert.rejects(() => unlockWeapon('tok', 'pistol'), (err: unknown) => {
      assert.ok(err instanceof ProfileApiError);
      assert.equal(err.status, 409);
      assert.equal(err.message, 'Weapon already owned');
      return true;
    });
  });
});
