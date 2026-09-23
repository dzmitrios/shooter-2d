import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { ServerMessage } from '@shooter/shared';
import { gameConfig, waves } from '../config/index.js';
import { GameInstance, type GameInstanceOptions, type RoomPlayer } from './gameInstance.js';
import type { RunPersistRecord } from './runPersistence.js';

function player(overrides: Partial<RoomPlayer> = {}): RoomPlayer {
  return {
    userId: 'u1',
    username: 'alice',
    weaponId: 'pistol',
    rank: 100,
    ...overrides,
  };
}

function createClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

function createInstance(
  players: RoomPlayer[],
  extra: GameInstanceOptions = {},
) {
  const clock = createClock();
  const messages: ServerMessage[] = [];
  const persisted: RunPersistRecord[][] = [];
  const { now: extraNow, ...rest } = extra;
  const instance = new GameInstance('room-1', players, 1, {
    autoStart: false,
    random: () => 1,
    waves: [],
    broadcast: (_userId, message) => {
      messages.push(message);
    },
    persistRun: async (_roomId, records) => {
      persisted.push(records);
    },
    ...rest,
    now: extraNow ?? (() => clock.now()),
  });
  instances.push(instance);
  return { instance, clock, messages, persisted };
}

const instances: GameInstance[] = [];

afterEach(() => {
  while (instances.length > 0) {
    instances.pop()?.destroy();
  }
});

describe('GameInstance', () => {
  it('initialises player state and fires ticks on an interval', async () => {
    const instance = new GameInstance('room-1', [player()], 7, { tickMs: 20 });
    instances.push(instance);

    const state = instance.getPlayer('u1');
    assert.ok(state);
    assert.equal(state.hp, gameConfig.player.baseHp);
    assert.equal(state.maxHp, gameConfig.player.baseMaxHp);
    assert.equal(state.weaponId, 'pistol');
    assert.equal(state.isDead, false);
    assert.equal(typeof state.x, 'number');
    assert.equal(typeof state.y, 'number');

    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.ok(instance.tickCount >= 2);
  });

  it('moves a player by normalised input, clamps to bounds, and echoes seq', () => {
    const { instance, clock } = createInstance([player()]);
    const before = instance.getPlayer('u1');
    assert.ok(before);

    instance.handleMove('u1', 3, 0, 11);
    clock.advance(50);
    instance.tick();

    const after = instance.getPlayer('u1');
    assert.ok(after);
    assert.equal(after.seq, 11);
    assert.ok(after.x > before.x);
    assert.equal(after.y, before.y);
    const expected = gameConfig.player.baseSpeed * 0.05;
    assert.ok(Math.abs(after.x - before.x - expected) < 1e-6);

    instance.handleMove('u1', 1, 0, 12);
    for (let i = 0; i < 400; i += 1) {
      clock.advance(50);
      instance.tick();
    }
    const clamped = instance.getPlayer('u1');
    assert.ok(clamped);
    assert.equal(clamped.x, gameConfig.arena.width - gameConfig.player.radius);
    assert.equal(clamped.seq, 12);
  });

  it('spawns a projectile on shoot using weapon damage', () => {
    const { instance } = createInstance([player()]);
    instance.handleShoot('u1', 0);
    const snapshot = instance.getSnapshot();
    assert.equal(snapshot.projectiles.length, 1);
    const projectile = snapshot.projectiles[0];
    assert.ok(projectile);
    assert.equal(projectile.ownerId, 'u1');
    assert.equal(projectile.damage, 20);
    assert.equal(projectile.vx, gameConfig.combat.projectileSpeed);
    assert.equal(projectile.vy, 0);
  });

  it('advances projectiles and despawns them at the arena boundary', () => {
    const { instance, clock } = createInstance([player()]);
    instance.handleShoot('u1', 0);
    clock.advance(50);
    instance.tick();
    const moving = instance.getSnapshot().projectiles[0];
    assert.ok(moving);
    assert.ok(moving.x > instance.getPlayer('u1')!.x);

    for (let i = 0; i < 80; i += 1) {
      clock.advance(50);
      instance.tick();
    }
    assert.equal(instance.getSnapshot().projectiles.length, 0);
  });

  it('applies projectile-monster hits and always drops an XP orb', () => {
    const { instance } = createInstance([player()]);
    const shooter = instance.getPlayer('u1');
    assert.ok(shooter);
    instance.spawnMonster({ type: 'melee', x: shooter.x, y: shooter.y, hp: 1 });
    instance.handleShoot('u1', 0);

    const snapshot = instance.getSnapshot();
    assert.equal(snapshot.monsters.length, 0);
    const xp = snapshot.pickups.find((pickup) => pickup.type === 'xp_orb');
    assert.ok(xp);
    assert.equal(xp.value, gameConfig.monsters.melee.xp);
    assert.equal(xp.x, shooter.x);
    assert.equal(xp.y, shooter.y);
    assert.equal(
      snapshot.pickups.some((pickup) => pickup.type === 'medkit'),
      false,
    );
  });

  it('drops a medkit at the configured probability using the monster XP value', () => {
    const { instance } = createInstance([player()], { random: () => 0 });
    const shooter = instance.getPlayer('u1');
    assert.ok(shooter);
    instance.spawnMonster({ type: 'swarm', x: shooter.x, y: shooter.y, hp: 1 });
    instance.handleShoot('u1', 0);

    const snapshot = instance.getSnapshot();
    const xp = snapshot.pickups.find((pickup) => pickup.type === 'xp_orb');
    const medkit = snapshot.pickups.find((pickup) => pickup.type === 'medkit');
    assert.ok(xp);
    assert.ok(medkit);
    assert.equal(xp.value, gameConfig.monsters.swarm.xp);
    assert.equal(medkit.value, gameConfig.combat.medkitHeal);
    assert.equal(medkit.x, shooter.x);
    assert.equal(medkit.y, shooter.y);

    const { instance: noMedkit } = createInstance([player()], {
      random: () => gameConfig.combat.medkitDropChance,
    });
    const other = noMedkit.getPlayer('u1');
    assert.ok(other);
    noMedkit.spawnMonster({ type: 'ranged', x: other.x, y: other.y, hp: 1 });
    noMedkit.handleShoot('u1', 0);
    const skipped = noMedkit.getSnapshot();
    assert.equal(
      skipped.pickups.find((pickup) => pickup.type === 'xp_orb')?.value,
      gameConfig.monsters.ranged.xp,
    );
    assert.equal(
      skipped.pickups.some((pickup) => pickup.type === 'medkit'),
      false,
    );
  });

  it('collects overlapping XP orbs into in-run XP and does not award XP on kill', () => {
    const { instance, clock } = createInstance([player()]);
    const shooter = instance.getPlayer('u1');
    assert.ok(shooter);
    assert.equal(shooter.xp, 0);
    assert.equal(shooter.level, 1);
    instance.spawnMonster({ type: 'melee', x: shooter.x, y: shooter.y, hp: 1 });
    instance.handleShoot('u1', 0);
    assert.equal(instance.getPlayer('u1')?.xp, 0);
    assert.equal(instance.getPlayer('u1')?.level, 1);
    assert.ok(instance.getSnapshot().pickups.some((pickup) => pickup.type === 'xp_orb'));

    clock.advance(50);
    instance.tick();
    const after = instance.getPlayer('u1');
    assert.ok(after);
    assert.equal(after.xp, gameConfig.monsters.melee.xp);
    assert.equal(after.level, 1);
    assert.equal(
      instance.getSnapshot().pickups.some((pickup) => pickup.type === 'xp_orb'),
      false,
    );
  });

  it('heals on medkit pickup and caps HP at maxHp', () => {
    const { instance, clock } = createInstance([player()], { random: () => 0 });
    const target = instance.getPlayer('u1');
    assert.ok(target);
    instance.spawnMonster({ type: 'melee', x: target.x, y: target.y, hp: 1 });

    clock.advance(50);
    instance.tick();
    const damaged = instance.getPlayer('u1');
    assert.ok(damaged);
    assert.equal(damaged.hp, gameConfig.player.baseHp - gameConfig.combat.meleeDamage);

    instance.handleShoot('u1', 0);
    clock.advance(50);
    instance.tick();
    const healed = instance.getPlayer('u1');
    assert.ok(healed);
    assert.equal(
      healed.hp,
      Math.min(
        gameConfig.player.baseMaxHp,
        damaged.hp + gameConfig.combat.medkitHeal,
      ),
    );
    assert.equal(
      instance.getSnapshot().pickups.some((pickup) => pickup.type === 'medkit'),
      false,
    );

    instance.spawnMonster({ type: 'swarm', x: healed.x, y: healed.y, hp: 1 });
    instance.handleShoot('u1', 0);
    clock.advance(50);
    instance.tick();
    assert.equal(instance.getPlayer('u1')?.hp, gameConfig.player.baseMaxHp);
  });

  it('damages overlapping players from melee monsters with a per-pair cooldown', () => {
    const { instance, clock } = createInstance([player()]);
    const target = instance.getPlayer('u1');
    assert.ok(target);
    instance.spawnMonster({ type: 'melee', x: target.x, y: target.y, hp: 50 });

    clock.advance(50);
    instance.tick();
    const once = instance.getPlayer('u1');
    assert.ok(once);
    assert.equal(once.hp, gameConfig.player.baseHp - gameConfig.combat.meleeDamage);

    clock.advance(50);
    instance.tick();
    const cooldown = instance.getPlayer('u1');
    assert.ok(cooldown);
    assert.equal(cooldown.hp, once.hp);

    clock.advance(gameConfig.combat.meleeCooldownMs);
    instance.tick();
    const twice = instance.getPlayer('u1');
    assert.ok(twice);
    assert.equal(twice.hp, once.hp - gameConfig.combat.meleeDamage);
  });

  it('broadcasts player:died once, drops an XP orb, and spectates the player', () => {
    const { instance, clock, messages } = createInstance([
      player(),
      player({ userId: 'u2', username: 'bob', rank: 80 }),
    ]);
    const target = instance.getPlayer('u1');
    assert.ok(target);
    instance.spawnMonster({ type: 'melee', x: target.x, y: target.y, hp: 999 });

    const hitsNeeded = Math.ceil(gameConfig.player.baseHp / gameConfig.combat.meleeDamage);
    for (let i = 0; i < hitsNeeded; i += 1) {
      clock.advance(gameConfig.combat.meleeCooldownMs);
      instance.tick();
    }

    const dead = instance.getPlayer('u1');
    assert.ok(dead);
    assert.equal(dead.isDead, true);
    assert.equal(dead.hp, 0);
    const died = messages.filter((message) => message.type === 'player:died');
    assert.equal(died.length, 2);
    assert.ok(died.every((message) => message.type === 'player:died' && message.playerId === 'u1'));

    const snapshot = instance.getSnapshot();
    const orb = snapshot.pickups.find((pickup) => pickup.type === 'xp_orb');
    assert.ok(orb);
    assert.equal(orb.value, gameConfig.combat.playerDeathXp);
    assert.equal(orb.x, dead.x);
    assert.equal(orb.y, dead.y);
    assert.equal(
      snapshot.pickups.some((pickup) => pickup.type === 'medkit'),
      false,
    );

    instance.handleMove('u1', 1, 0, 99);
    instance.handleShoot('u1', 1);
    clock.advance(50);
    instance.tick();
    assert.equal(instance.getPlayer('u1')?.x, dead.x);
    assert.equal(instance.getPlayer('u1')?.xp, 0);
    assert.equal(instance.getSnapshot().projectiles.length, 0);
    assert.equal(instance.getPlayer('u2')?.isDead, false);
    assert.ok(instance.getSnapshot().pickups.some((pickup) => pickup.id === orb.id));
  });

  it('ends the run when all players are dead, broadcasts results, and persists rows', async () => {
    const { instance, clock, messages, persisted } = createInstance([
      player({ rank: 40 }),
      player({ userId: 'u2', username: 'bob', rank: 40 }),
    ]);
    const a = instance.getPlayer('u1');
    const b = instance.getPlayer('u2');
    assert.ok(a);
    assert.ok(b);
    instance.spawnMonster({ type: 'melee', x: a.x, y: a.y, hp: 999 });
    instance.spawnMonster({ type: 'melee', x: b.x, y: b.y, hp: 999 });

    const hitsNeeded = Math.ceil(gameConfig.player.baseHp / gameConfig.combat.meleeDamage);
    for (let i = 0; i < hitsNeeded; i += 1) {
      clock.advance(gameConfig.combat.meleeCooldownMs);
      instance.tick();
    }

    await new Promise((resolve) => setImmediate(resolve));

    const ended = messages.filter((message) => message.type === 'run:ended');
    assert.equal(ended.length, 2);
    assert.equal(ended[0]?.type, 'run:ended');
    if (ended[0]?.type !== 'run:ended') {
      return;
    }
    assert.equal(ended[0].results.length, 2);

    assert.equal(persisted.length, 1);
    const rows = persisted[0];
    assert.ok(rows);
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.rankBefore, 40);
      assert.equal(row.rankAfter, 40 + gameConfig.rank.winDelta);
      assert.ok(row.wavesSurvived >= 1);
      assert.ok(row.survivedSec > 0);
    }

    const ticksAfter = instance.tickCount;
    clock.advance(50);
    instance.tick();
    assert.equal(instance.tickCount, ticksAfter);
  });

  it('broadcasts a full state snapshot each tick', () => {
    const { instance, clock, messages } = createInstance([player()]);
    clock.advance(50);
    instance.tick();
    const snapshots = messages.filter((message) => message.type === 'state:snapshot');
    assert.equal(snapshots.length, 1);
    const snapshot = snapshots[0];
    assert.ok(snapshot);
    assert.equal(snapshot.type, 'state:snapshot');
    if (snapshot.type !== 'state:snapshot') {
      return;
    }
    assert.equal(snapshot.tick, 1);
    assert.equal(snapshot.players.length, 1);
    assert.ok(Array.isArray(snapshot.monsters));
    assert.ok(Array.isArray(snapshot.projectiles));
    assert.ok(Array.isArray(snapshot.pickups));
  });

  it('applies permanent upgrade levels to movement speed at run start', () => {
    const { instance, clock } = createInstance([
      player({ permanentUpgrades: { move_speed: 2, reload_speed: 0, damage: 0 } }),
    ]);
    const before = instance.getPlayer('u1');
    assert.ok(before);
    instance.handleMove('u1', 1, 0, 1);
    clock.advance(50);
    instance.tick();
    const after = instance.getPlayer('u1');
    assert.ok(after);
    const expected =
      (gameConfig.player.baseSpeed + gameConfig.upgrades.move_speed.delta * 2) * 0.05;
    assert.ok(Math.abs(after.x - before.x - expected) < 1e-6);
  });

  it('exposes in-run upgrade deltas from game.json', () => {
    const { instance } = createInstance([player()]);
    assert.equal(instance.upgradeDeltas.move_speed.delta, gameConfig.upgrades.move_speed.delta);
    assert.equal(instance.upgradeDeltas.reload_speed.delta, gameConfig.upgrades.reload_speed.delta);
    assert.equal(instance.upgradeDeltas.damage.delta, gameConfig.upgrades.damage.delta);
  });

  it('spawns the first wave at configured startSec', () => {
    const { instance, clock } = createInstance([player()], {
      waves: [
        {
          startSec: 0.05,
          endSec: 10,
          spawns: [
            { type: 'melee', count: 2, hpMultiplier: 1 },
            { type: 'swarm', count: 3, hpMultiplier: 0.6 },
          ],
        },
      ],
    });

    instance.tick();
    assert.equal(instance.getSnapshot().monsters.length, 0);

    clock.advance(50);
    instance.tick();
    const snapshot = instance.getSnapshot();
    assert.equal(snapshot.monsters.length, 5);
    assert.equal(snapshot.monsters.filter((monster) => monster.type === 'melee').length, 2);
    assert.equal(snapshot.monsters.filter((monster) => monster.type === 'swarm').length, 3);
  });

  it('moves a melee monster to a stationary player and deals contact damage', () => {
    const { instance, clock } = createInstance([player()]);
    const target = instance.getPlayer('u1');
    assert.ok(target);
    instance.spawnMonster({
      type: 'melee',
      x: target.x - 80,
      y: target.y,
      hp: 80,
    });

    let reached = false;
    for (let i = 0; i < 80; i += 1) {
      clock.advance(50);
      instance.tick();
      const monster = instance.getSnapshot().monsters[0];
      const current = instance.getPlayer('u1');
      assert.ok(monster);
      assert.ok(current);
      if (current.hp < gameConfig.player.baseHp) {
        reached = true;
        assert.ok(monster.x > target.x - 80);
        break;
      }
    }
    assert.equal(reached, true);
  });

  it('holds range and fires a projectile at the nearest player', () => {
    const { instance, clock } = createInstance([player()]);
    const target = instance.getPlayer('u1');
    assert.ok(target);
    const ranged = gameConfig.monsters.ranged;
    instance.spawnMonster({
      type: 'ranged',
      x: target.x + (ranged.minRange + ranged.maxRange) / 2,
      y: target.y,
    });

    clock.advance(50);
    instance.tick();
    const snapshot = instance.getSnapshot();
    assert.equal(snapshot.projectiles.length, 1);
    const projectile = snapshot.projectiles[0];
    const monster = snapshot.monsters[0];
    assert.ok(projectile);
    assert.ok(monster);
    assert.equal(projectile.ownerId, monster.id);
    assert.equal(projectile.damage, ranged.damage);
    assert.ok(projectile.vx < 0);
  });

  it('seeks with swarm units that are faster and weaker than melee', () => {
    const { instance, clock } = createInstance([player()], {
      waves: [
        {
          startSec: 0,
          endSec: 10,
          spawns: [{ type: 'swarm', count: 5, hpMultiplier: 1 }],
        },
      ],
    });
    const target = instance.getPlayer('u1');
    assert.ok(target);

    clock.advance(50);
    instance.tick();
    const swarmBatch = instance.getSnapshot().monsters.filter((monster) => monster.type === 'swarm');
    assert.equal(swarmBatch.length, 5);
    assert.ok(swarmBatch.every((monster) => monster.hp === gameConfig.monsters.swarm.hp));

    instance.spawnMonster({ type: 'melee', x: target.x - 200, y: target.y });
    instance.spawnMonster({ type: 'swarm', x: target.x - 200, y: target.y });
    const afterSpawn = instance.getSnapshot().monsters;
    const melee = afterSpawn.find((monster) => monster.type === 'melee');
    const swarm = afterSpawn.find(
      (monster) => monster.type === 'swarm' && monster.x === target.x - 200,
    );
    assert.ok(melee);
    assert.ok(swarm);
    assert.ok(swarm.hp < melee.hp);

    clock.advance(50);
    instance.tick();
    const moved = instance.getSnapshot().monsters;
    const meleeMoved = moved.find((monster) => monster.id === melee.id);
    const swarmMoved = moved.find((monster) => monster.id === swarm.id);
    assert.ok(meleeMoved);
    assert.ok(swarmMoved);
    assert.ok(swarmMoved.x > meleeMoved.x);
  });

  it('moves monster projectiles and damages players on overlap', () => {
    const { instance, clock } = createInstance([player()]);
    const target = instance.getPlayer('u1');
    assert.ok(target);
    const ranged = gameConfig.monsters.ranged;
    instance.spawnMonster({
      type: 'ranged',
      x: target.x + 220,
      y: target.y,
    });

    let damaged = false;
    for (let i = 0; i < 40; i += 1) {
      clock.advance(50);
      instance.tick();
      const current = instance.getPlayer('u1');
      assert.ok(current);
      if (current.hp < gameConfig.player.baseHp) {
        damaged = true;
        assert.equal(current.hp, gameConfig.player.baseHp - ranged.damage);
        break;
      }
    }
    assert.equal(damaged, true);
  });

  it('spawns later waves with more and tougher monsters after 3 minutes', () => {
    const { instance, clock } = createInstance([player()], {
      waves,
      config: {
        ...gameConfig,
        player: { ...gameConfig.player, baseHp: 1_000_000, baseMaxHp: 1_000_000 },
        combat: { ...gameConfig.combat, meleeDamage: 0 },
        monsters: {
          ...gameConfig.monsters,
          melee: { ...gameConfig.monsters.melee, damage: 0 },
          ranged: { ...gameConfig.monsters.ranged, damage: 0 },
          swarm: { ...gameConfig.monsters.swarm, damage: 0 },
        },
      },
    });
    const seen = new Set<string>();
    const batches: Array<{ count: number; meleeHp: number[] }> = [];

    for (const wave of waves) {
      const targetMs = Math.max(wave.startSec * 1000, 50) + 200;
      while (clock.now() < targetMs) {
        clock.advance(50);
        instance.tick();
      }
      const snapshot = instance.getSnapshot();
      const fresh = snapshot.monsters.filter((monster) => !seen.has(monster.id));
      for (const monster of fresh) {
        seen.add(monster.id);
      }
      const expected = wave.spawns.reduce((sum, spawn) => sum + spawn.count, 0);
      assert.equal(fresh.length, expected);
      batches.push({
        count: fresh.length,
        meleeHp: fresh.filter((monster) => monster.type === 'melee').map((monster) => monster.hp),
      });
    }

    assert.equal(batches.length, waves.length);
    assert.ok(waves[4]!.startSec >= 180);
    for (let i = 1; i < batches.length; i += 1) {
      assert.ok(batches[i]!.count > batches[i - 1]!.count);
      const prevHp = Math.max(...(batches[i - 1]!.meleeHp.length ? batches[i - 1]!.meleeHp : [0]));
      const nextHp = Math.max(...batches[i]!.meleeHp);
      assert.ok(nextHp >= prevHp);
    }
    assert.ok(Math.max(...batches[0]!.meleeHp) < Math.max(...batches[4]!.meleeHp));
  });


  it('escalates HP or batch size after twice the first wave duration', () => {
    const first = waves[0];
    const second = waves[1];
    assert.ok(first);
    assert.ok(second);
    const firstDuration = first.endSec - first.startSec;
    const firstCount = first.spawns.reduce((sum, spawn) => sum + spawn.count, 0);
    const firstMaxHp = Math.max(
      ...first.spawns.map((spawn) =>
        Math.round(gameConfig.monsters[spawn.type].hp * spawn.hpMultiplier),
      ),
    );
    const secondCount = second.spawns.reduce((sum, spawn) => sum + spawn.count, 0);
    const secondMaxHp = Math.max(
      ...second.spawns.map((spawn) =>
        Math.round(gameConfig.monsters[spawn.type].hp * spawn.hpMultiplier),
      ),
    );
    assert.ok(secondCount > firstCount || secondMaxHp > firstMaxHp);

    const { instance, clock } = createInstance([player()], {
      waves,
      config: {
        ...gameConfig,
        player: { ...gameConfig.player, baseHp: 1_000_000, baseMaxHp: 1_000_000 },
      },
    });

    clock.advance(Math.max(first.startSec * 1000, 50));
    instance.tick();
    const wave1 = instance.getSnapshot().monsters;
    assert.equal(wave1.length, firstCount);
    const wave1MaxHp = Math.max(...wave1.map((monster) => monster.hp));

    const remainingMs = firstDuration * 2 * 1000 - Math.max(first.startSec * 1000, 50);
    const steps = Math.ceil(remainingMs / 50);
    for (let i = 0; i < steps; i += 1) {
      clock.advance(50);
      instance.tick();
    }

    const later = instance.getSnapshot().monsters;
    const laterMaxHp = Math.max(...later.map((monster) => monster.hp));
    assert.ok(later.length > wave1.length || laterMaxHp > wave1MaxHp);
    assert.ok(later.length >= firstCount + secondCount);
  });

  it('despawns uncollected pickups after the configured timeout', () => {
    const despawnMs = 200;
    const { instance, clock } = createInstance([player()], {
      random: () => 0,
      config: {
        ...gameConfig,
        combat: { ...gameConfig.combat, pickupDespawnMs: despawnMs },
      },
    });
    const shooter = instance.getPlayer('u1');
    assert.ok(shooter);
    instance.spawnMonster({ type: 'melee', x: shooter.x + 80, y: shooter.y, hp: 1 });
    instance.handleShoot('u1', 0);

    let dropped = false;
    for (let i = 0; i < 20; i += 1) {
      clock.advance(50);
      instance.tick();
      if (instance.getSnapshot().pickups.length > 0) {
        dropped = true;
        break;
      }
    }
    assert.equal(dropped, true);
    assert.ok(instance.getSnapshot().pickups.length >= 1);
    assert.equal(instance.getPlayer('u1')?.xp, 0);

    clock.advance(despawnMs);
    instance.tick();
    assert.equal(instance.getSnapshot().pickups.length, 0);
    assert.equal(instance.getPlayer('u1')?.xp, 0);
    assert.equal(instance.getPlayer('u1')?.hp, gameConfig.player.baseHp);
  });

  it('levels up when XP reaches the curve threshold and broadcasts the three fixed choices', () => {
    const { instance, clock, messages } = createProgressionInstance([
      player(),
      player({ userId: 'u2', username: 'bob', rank: 80 }),
    ]);
    collectMeleeOrb(instance, clock, 'u1');

    const after = instance.getPlayer('u1');
    assert.ok(after);
    assert.equal(after.xp, 10);
    assert.equal(after.level, 2);
    assert.equal(instance.getPlayer('u2')?.level, 1);

    const levelUps = messages.filter((message) => message.type === 'player:levelUp');
    assert.equal(levelUps.length, 2);
    assert.ok(
      levelUps.every(
        (message) =>
          message.type === 'player:levelUp' &&
          message.playerId === 'u1' &&
          message.choices[0] === 'move_speed' &&
          message.choices[1] === 'reload_speed' &&
          message.choices[2] === 'damage' &&
          message.choices.length === 3,
      ),
    );
  });

  it('applies chooseUpgrade deltas and ignores invalid or unoffered options', () => {
    const { instance, clock } = createProgressionInstance([player()]);
    const before = instance.getCombatStats('u1');
    assert.ok(before);

    instance.handleChooseUpgrade('u1', 'move_speed');
    instance.handleChooseUpgrade('u1', 'damage');
    assert.deepEqual(instance.getCombatStats('u1'), before);

    collectMeleeOrb(instance, clock, 'u1');
    instance.handleChooseUpgrade('u1', 'nuke');
    assert.deepEqual(instance.getCombatStats('u1'), before);

    instance.handleChooseUpgrade('u1', 'move_speed');
    const afterMove = instance.getCombatStats('u1');
    assert.ok(afterMove);
    assert.equal(afterMove.speed, before.speed + gameConfig.upgrades.move_speed.delta);
    assert.equal(afterMove.damage, before.damage);
    assert.equal(afterMove.reloadMs, before.reloadMs);

    instance.handleMove('u1', 1, 0, 1);
    const posBefore = instance.getPlayer('u1');
    assert.ok(posBefore);
    clock.advance(50);
    instance.tick();
    const posAfter = instance.getPlayer('u1');
    assert.ok(posAfter);
    assert.ok(Math.abs(posAfter.x - posBefore.x - afterMove.speed * 0.05) < 1e-6);

    instance.handleChooseUpgrade('u1', 'damage');
    assert.deepEqual(instance.getCombatStats('u1'), afterMove);

    const { instance: damageRun, clock: damageClock } = createProgressionInstance([player()]);
    collectMeleeOrb(damageRun, damageClock, 'u1');
    damageRun.handleChooseUpgrade('u1', 'damage');
    damageRun.handleShoot('u1', 0);
    const projectile = damageRun.getSnapshot().projectiles[0];
    assert.ok(projectile);
    assert.equal(projectile.damage, 20 * (1 + gameConfig.upgrades.damage.delta));

    const { instance: reloadRun, clock: reloadClock } = createProgressionInstance([player()]);
    const reloadBefore = reloadRun.getCombatStats('u1');
    assert.ok(reloadBefore);
    collectMeleeOrb(reloadRun, reloadClock, 'u1');
    reloadRun.handleChooseUpgrade('u1', 'reload_speed');
    const reloadAfter = reloadRun.getCombatStats('u1');
    assert.ok(reloadAfter);
    assert.equal(
      reloadAfter.reloadMs,
      reloadBefore.reloadMs * (1 - gameConfig.upgrades.reload_speed.delta),
    );
    assert.equal(reloadAfter.speed, reloadBefore.speed);
    assert.equal(reloadAfter.damage, reloadBefore.damage);
  });

  it('does not persist in-run xp or level when the run ends', async () => {
    const { instance, clock, persisted } = createProgressionInstance([player({ rank: 40 })]);
    collectMeleeOrb(instance, clock, 'u1');
    assert.equal(instance.getPlayer('u1')?.xp, 10);
    assert.equal(instance.getPlayer('u1')?.level, 2);

    const target = instance.getPlayer('u1');
    assert.ok(target);
    instance.spawnMonster({ type: 'melee', x: target.x, y: target.y, hp: 999 });
    const hitsNeeded = Math.ceil(gameConfig.player.baseHp / gameConfig.combat.meleeDamage);
    for (let i = 0; i < hitsNeeded; i += 1) {
      clock.advance(gameConfig.combat.meleeCooldownMs);
      instance.tick();
    }
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(persisted.length, 1);
    const rows = persisted[0];
    assert.ok(rows);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.ok(row);
    assert.equal('xp' in row, false);
    assert.equal('level' in row, false);
    assert.deepEqual(Object.keys(row).sort(), [
      'kills',
      'metaPointsEarned',
      'rankAfter',
      'rankBefore',
      'survivedSec',
      'userId',
      'wavesSurvived',
    ]);
  });
});

function createProgressionInstance(players: RoomPlayer[]) {
  return createInstance(players, {
    config: {
      ...gameConfig,
      xpCurve: [0, 10, 10_000],
      monsters: {
        ...gameConfig.monsters,
        melee: { ...gameConfig.monsters.melee, xp: 10 },
      },
    },
  });
}

function collectMeleeOrb(
  instance: GameInstance,
  clock: { advance(ms: number): void },
  userId: string,
): void {
  const shooter = instance.getPlayer(userId);
  assert.ok(shooter);
  instance.spawnMonster({ type: 'melee', x: shooter.x, y: shooter.y, hp: 1 });
  instance.handleShoot(userId, 0);
  clock.advance(50);
  instance.tick();
}
