import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { AUTH_TOKEN_KEY, resetAuthStore, useAuthStore } from './authStore.ts';

function encodeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

function installMemoryLocalStorage(): void {
  const data = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key) {
      data.delete(key);
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  });
}

describe('auth store', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    resetAuthStore();
  });

  it('stores the JWT in Zustand and localStorage and redirects to Hub', () => {
    const token = encodeJwt({ userId: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 });
    useAuthStore.getState().setSession(token, 'user-1');

    assert.equal(localStorage.getItem(AUTH_TOKEN_KEY), token);
    assert.equal(useAuthStore.getState().token, token);
    assert.equal(useAuthStore.getState().userId, 'user-1');
    assert.equal(useAuthStore.getState().screen, 'hub');
  });

  it('hydrates a non-expired JWT and skips auth', () => {
    const token = encodeJwt({ userId: 'user-7', exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem(AUTH_TOKEN_KEY, token);

    useAuthStore.getState().hydrate();

    assert.equal(useAuthStore.getState().token, token);
    assert.equal(useAuthStore.getState().userId, 'user-7');
    assert.equal(useAuthStore.getState().screen, 'hub');
  });

  it('clears an expired JWT and stays on auth', () => {
    const token = encodeJwt({ userId: 'user-7', exp: Math.floor(Date.now() / 1000) - 10 });
    localStorage.setItem(AUTH_TOKEN_KEY, token);

    useAuthStore.getState().hydrate();

    assert.equal(localStorage.getItem(AUTH_TOKEN_KEY), null);
    assert.equal(useAuthStore.getState().token, null);
    assert.equal(useAuthStore.getState().screen, 'auth');
  });
});
