import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { xpBar, waveFromTick } from './hud.ts';

describe('hud helpers', () => {
  it('maps snapshot ticks onto the current wave', () => {
    const waves = [
      { startSec: 0, endSec: 30, spawns: [] },
      { startSec: 30, endSec: 70, spawns: [] },
    ];
    assert.equal(waveFromTick(1, waves), 1);
    assert.equal(waveFromTick(700, waves), 2);
  });

  it('fills the XP bar between level thresholds', () => {
    const bar = xpBar(50, 1);
    assert.equal(bar.current, 50);
    assert.equal(bar.next, 100);
    assert.equal(bar.ratio, 0.5);
  });
});
