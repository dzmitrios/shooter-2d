import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InputRateLimiter } from './inputRateLimiter.js';

describe('InputRateLimiter', () => {
  it('allows up to maxPerSecond then drops excess in the same window', () => {
    let now = 0;
    const limiter = new InputRateLimiter({ maxPerSecond: 3, violationThreshold: 5 }, () => now);

    assert.equal(limiter.consume('a').action, 'allow');
    assert.equal(limiter.consume('a').action, 'allow');
    assert.equal(limiter.consume('a').action, 'allow');

    const firstDrop = limiter.consume('a');
    assert.equal(firstDrop.action, 'drop');
    assert.equal(firstDrop.warn, true);

    const secondDrop = limiter.consume('a');
    assert.equal(secondDrop.action, 'drop');
    assert.equal(secondDrop.warn, false);
  });

  it('opens a new window after one second', () => {
    let now = 0;
    const limiter = new InputRateLimiter({ maxPerSecond: 1, violationThreshold: 5 }, () => now);

    assert.equal(limiter.consume('a').action, 'allow');
    assert.equal(limiter.consume('a').action, 'drop');

    now = 1000;
    assert.equal(limiter.consume('a').action, 'allow');
    assert.equal(limiter.consume('a').action, 'drop');
  });

  it('kicks after repeated window violations', () => {
    let now = 0;
    const limiter = new InputRateLimiter({ maxPerSecond: 1, violationThreshold: 2 }, () => now);

    assert.equal(limiter.consume('a').action, 'allow');
    assert.equal(limiter.consume('a').action, 'drop');

    now = 1000;
    assert.equal(limiter.consume('a').action, 'allow');
    const kicked = limiter.consume('a');
    assert.equal(kicked.action, 'kick');
    assert.equal(kicked.warn, true);
  });

  it('tracks connections independently', () => {
    const limiter = new InputRateLimiter({ maxPerSecond: 1, violationThreshold: 5 }, () => 0);
    assert.equal(limiter.consume('a').action, 'allow');
    assert.equal(limiter.consume('b').action, 'allow');
    assert.equal(limiter.consume('a').action, 'drop');
    assert.equal(limiter.consume('b').action, 'drop');
  });

  it('resets after forget', () => {
    const limiter = new InputRateLimiter({ maxPerSecond: 1, violationThreshold: 5 }, () => 0);
    assert.equal(limiter.consume('a').action, 'allow');
    assert.equal(limiter.consume('a').action, 'drop');
    limiter.forget('a');
    assert.equal(limiter.consume('a').action, 'allow');
  });
});
