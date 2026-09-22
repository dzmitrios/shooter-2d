import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../App.tsx';
import { AUTH_TOKEN_KEY, resetAuthStore, useAuthStore } from './authStore.ts';
import { AuthPage } from '../pages/AuthPage.tsx';

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

describe('Client auth flow', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    resetAuthStore();
  });

  it('renders Play as Guest and Login / Register options', () => {
    const html = renderToStaticMarkup(createElement(AuthPage));
    assert.match(html, /Play as Guest/);
    assert.match(html, /Login \/ Register/);
    assert.match(html, />Login</);
    assert.match(html, />Register</);
  });

  it('redirects to Hub after a successful session is stored', () => {
    const token = encodeJwt({ userId: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 });
    useAuthStore.getState().setSession(token, 'user-1');

    assert.equal(localStorage.getItem(AUTH_TOKEN_KEY), token);
    const html = renderToStaticMarkup(createElement(App));
    assert.match(html, />Hub</);
    assert.doesNotMatch(html, /Play as Guest/);
  });

  it('skips auth and goes to Hub when a valid JWT is already stored', () => {
    const token = encodeJwt({ userId: 'user-9', exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem(AUTH_TOKEN_KEY, token);

    const html = renderToStaticMarkup(createElement(App));
    assert.equal(useAuthStore.getState().screen, 'hub');
    assert.equal(useAuthStore.getState().userId, 'user-9');
    assert.match(html, />Hub</);
  });
});
