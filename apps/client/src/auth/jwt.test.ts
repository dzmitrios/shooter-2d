import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeJwtPayload, isJwtExpired, readValidJwt } from './jwt.ts';

function encodeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

describe('JWT helpers', () => {
  it('decodes a userId payload', () => {
    const token = encodeJwt({ userId: 'user-1', exp: 1_700_000_000 });
    assert.deepEqual(decodeJwtPayload(token), { userId: 'user-1', exp: 1_700_000_000 });
  });

  it('rejects malformed tokens', () => {
    assert.equal(decodeJwtPayload('not-a-jwt'), null);
    assert.equal(decodeJwtPayload('a.b'), null);
  });

  it('treats exp in the past as expired', () => {
    const payload = { userId: 'user-1', exp: 100 };
    assert.equal(isJwtExpired(payload, 100_000), true);
    assert.equal(isJwtExpired({ userId: 'user-1' }, 100_000), false);
  });

  it('accepts a non-expired token and rejects an expired one', () => {
    const now = 1_700_000_000_000;
    const valid = encodeJwt({ userId: 'user-1', exp: Math.floor(now / 1000) + 60 });
    const expired = encodeJwt({ userId: 'user-1', exp: Math.floor(now / 1000) - 1 });
    assert.equal(readValidJwt(valid, now)?.userId, 'user-1');
    assert.equal(readValidJwt(expired, now), null);
    assert.equal(readValidJwt(null, now), null);
  });
});
