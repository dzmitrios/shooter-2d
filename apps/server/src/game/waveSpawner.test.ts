import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WaveConfig } from '@shooter/shared';
import { waves as waveConfig } from '../config/index.js';
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

  it('escalates spawn count and hp across 3+ minutes of waves.json', () => {
    const spawner = new WaveSpawner(waveConfig, arena);
    const batches = waveConfig.map((wave) => {
      const spawned = spawner.collectSpawns(wave.startSec);
      const expected = wave.spawns.reduce((sum, entry) => sum + entry.count, 0);
      assert.equal(spawned.length, expected);
      return spawned;
    });

    assert.ok(batches[0] && batches[4]);
    assert.ok(batches[0].length < batches[1]!.length);
    assert.ok(batches[1]!.length < batches[2]!.length);
    assert.ok(batches[2]!.length < batches[3]!.length);
    assert.ok(batches[3]!.length < batches[4].length);
    assert.ok(waveConfig[4]!.startSec >= 180);

    const firstMelee = waveConfig[0]?.spawns.find((entry) => entry.type === 'melee');
    const lastMelee = waveConfig[4]?.spawns.find((entry) => entry.type === 'melee');
    assert.ok(firstMelee);
    assert.ok(lastMelee);
    assert.ok(lastMelee.count > firstMelee.count);
    assert.ok(lastMelee.hpMultiplier > firstMelee.hpMultiplier);
  });
});
