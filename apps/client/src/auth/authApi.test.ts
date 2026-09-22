import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { AuthApiError, login, loginGuest, register } from './authApi.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(status: number, body: unknown): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      url,
      method: init?.method,
      body: init?.body,
    } as Response;
  }) as typeof fetch;
}

describe('auth API', () => {
  it('POSTs /auth/guest and returns the session', async () => {
    let url = '';
    let method = '';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      method = init?.method ?? 'GET';
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: 'guest-token', userId: 'guest-1' }),
      } as Response;
    }) as typeof fetch;

    const session = await loginGuest();
    assert.equal(url, '/auth/guest');
    assert.equal(method, 'POST');
    assert.deepEqual(session, { token: 'guest-token', userId: 'guest-1' });
  });

  it('POSTs credentials to /auth/login', async () => {
    let url = '';
    let rawBody = '';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      rawBody = String(init?.body ?? '');
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: 'login-token', userId: 'user-1' }),
      } as Response;
    }) as typeof fetch;

    const session = await login('ada', 'secret');
    assert.equal(url, '/auth/login');
    assert.equal(rawBody, JSON.stringify({ username: 'ada', password: 'secret' }));
    assert.equal(session.token, 'login-token');
  });

  it('POSTs credentials to /auth/register', async () => {
    let url = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      url = String(input);
      return {
        ok: true,
        status: 201,
        json: async () => ({ token: 'reg-token', userId: 'user-2' }),
      } as Response;
    }) as typeof fetch;

    const session = await register('ada', 'secret');
    assert.equal(url, '/auth/register');
    assert.equal(session.userId, 'user-2');
  });

  it('throws AuthApiError on 401', async () => {
    mockFetch(401, { error: 'Invalid credentials' });
    await assert.rejects(() => login('ada', 'nope'), (err: unknown) => {
      assert.ok(err instanceof AuthApiError);
      assert.equal(err.status, 401);
      assert.equal(err.message, 'Invalid credentials');
      return true;
    });
  });
});
