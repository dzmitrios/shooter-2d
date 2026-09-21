import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WaveConfig } from '@shooter/shared';
import { WaveSpawner } from './waveSpawner.js';

const arena = {
  width: 400,
  height: 300,
  inset: 10,
  clusterSpread: 8,
  random: () => 0.5,
};

describe('WaveSpawner', () => {
  it('spawns the first wave at configured startSec and not before', () => {
    const waves: WaveConfig[] = [
      {
        startSec: 2,
        endSec: 6,
        spawns: [{ type: 'melee', count: 3, hpMultiplier: 1 }],
      },
    ];
    const spawner = new WaveSpawner(waves, arena);

    assert.equal(spawner.collectSpawns(1.99).length, 0);
    const spawned = spawner.collectSpawns(2);
    assert.equal(spawned.length, 3);
    assert.ok(spawned.every((spawn) => spawn.type === 'melee'));
    assert.equal(spawner.collectSpawns(2.5).length, 0);
  });

  it('spawns swarm units in a clustered batch around an arena edge', () => {
    const waves: WaveConfig[] = [
      {
        startSec: 0,
        endSec: 10,
        spawns: [{ type: 'swarm', count: 6, hpMultiplier: 0.6 }],
      },
    ];
    const spawner = new WaveSpawner(waves, arena);
    const spawned = spawner.collectSpawns(0);
    assert.equal(spawned.length, 6);
    assert.ok(spawned.every((spawn) => spawn.type === 'swarm'));

    const xs = spawned.map((spawn) => spawn.x);
    const ys = spawned.map((spawn) => spawn.y);
    const spreadX = Math.max(...xs) - Math.min(...xs);
    const spreadY = Math.max(...ys) - Math.min(...ys);
    assert.ok(spreadX <= arena.clusterSpread * 2 + 1e-6);
    assert.ok(spreadY <= arena.clusterSpread * 2 + 1e-6);

    const onEdge = spawned.every(
      (spawn) =>
        spawn.x <= arena.inset + arena.clusterSpread + 1e-6 ||
        spawn.x >= arena.width - arena.inset - arena.clusterSpread - 1e-6 ||
        spawn.y <= arena.inset + arena.clusterSpread + 1e-6 ||
        spawn.y >= arena.height - arena.inset - arena.clusterSpread - 1e-6,
    );
    assert.equal(onEdge, true);
  });
});
