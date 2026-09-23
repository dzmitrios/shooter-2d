import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import type { ServerMessage, StateSnapshotMessage } from '@shooter/shared';
import { db } from '@shooter/db';
import { WebSocket } from 'ws';
import { gameConfig } from '../config/index.js';
import { createApp } from '../rest/app.js';
import { signToken } from '../rest/jwt.js';
import { createGameContext, type GameContextOptions } from '../ws/context.js';
import { attachWebSocket } from '../ws/gateway.js';
import { AUTO_START_MS } from '../ws/matchmaking.js';
import { MemoryPlayerDirectory } from '../ws/playerDirectory.js';
import { MemoryRoomStore } from '../ws/roomStore.js';

process.env['JWT_SECRET'] ??= 'test-secret';

const hasDb = Boolean(process.env['DATABASE_URL']);

const soloRunConfig = {
  ...gameConfig,
  xpCurve: [0, 10, 10_000],
};

interface TestServer {
  url: string;
  httpUrl: string;
  ctx: ReturnType<typeof createGameContext>;
  clock: { t: number };
  close: () => Promise<void>;
  sockets: WebSocket[];
}

const servers: TestServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server?.close();
  }
});

async function startServer(options: GameContextOptions = {}): Promise<TestServer> {
  const clock = { t: 0 };
  const httpServer = http.createServer(createApp());
  const ctx = createGameContext({
    persistRun: async () => {},
    roomStore: new MemoryRoomStore(),
    now: () => clock.t,
    ...options,
  });
  attachWebSocket(httpServer, ctx);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, resolve);
  });
  const sockets: WebSocket[] = [];
  const address = httpServer.address() as AddressInfo;
  const testServer: TestServer = {
    url: wsUrl(address),
    httpUrl: httpUrl(address),
    ctx,
    clock,
    sockets,
    close: async () => {
      ctx.matchmaking.stop();
      ctx.rooms.destroyAll();
      for (const socket of sockets) {
        socket.on('error', () => {});
        if (
          socket.readyState === WebSocket.CONNECTING ||
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CLOSING
        ) {
          socket.terminate();
        }
      }
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
  servers.push(testServer);
  return testServer;
}

function wsUrl(addr: AddressInfo): string {
  return `${protocolHost(addr, 'ws')}`;
}

function httpUrl(addr: AddressInfo): string {
  return `${protocolHost(addr, 'http')}`;
}

function protocolHost(addr: AddressInfo, protocol: 'ws' | 'http'): string {
  const ipv6 = addr.family === 'IPv6';
  let host = addr.address;
  if (ipv6) {
    if (host === '::') {
      host = '::1';
    }
    host = `[${host}]`;
  } else if (host === '0.0.0.0') {
    host = '127.0.0.1';
  }
  return `${protocol}://${host}:${addr.port}`;
}

function connectWithToken(server: TestServer, token: string): Promise<WebSocket> {
  const ws = new WebSocket(`${server.url}/?token=${encodeURIComponent(token)}`);
  ws.on('error', () => {});
  server.sockets.push(ws);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

async function connect(server: TestServer, userId: string, token?: string): Promise<WebSocket> {
  const ws = await connectWithToken(server, token ?? signToken(userId));
  await waitUntil(() => server.ctx.sessions.getByUserId(userId));
  await new Promise((resolve) => setImmediate(resolve));
  return ws;
}

function sendJson(ws: WebSocket, payload: unknown): void {
  ws.send(JSON.stringify(payload));
}

class WsInbox {
  readonly messages: ServerMessage[] = [];
  private readonly consumed = new WeakSet<ServerMessage>();
  private readonly waiters: Array<{
    match: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(ws: WebSocket) {
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      this.messages.push(message);
      const index = this.waiters.findIndex((waiter) => waiter.match(message));
      if (index >= 0) {
        const [waiter] = this.waiters.splice(index, 1);
        if (waiter) {
          this.consumed.add(message);
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        }
      }
    });
  }

  errors(): ServerMessage[] {
    return this.messages.filter((message) => message.type === 'error');
  }

  latestSnapshot(): StateSnapshotMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      const message = this.messages[i];
      if (message?.type === 'state:snapshot') {
        return message;
      }
    }
    return undefined;
  }

  waitFor(
    type: ServerMessage['type'],
    timeoutMs = 4000,
    predicate?: (message: ServerMessage) => boolean,
  ): Promise<ServerMessage> {
    const match = (message: ServerMessage) =>
      message.type === type &&
      !this.consumed.has(message) &&
      (!predicate || predicate(message));
    const existing = this.messages.find(match);
    if (existing) {
      this.consumed.add(existing);
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIndex = this.waiters.findIndex((waiter) => waiter.timer === timer);
        if (waiterIndex >= 0) {
          this.waiters.splice(waiterIndex, 1);
        }
        reject(new Error(`timed out waiting for ${type}`));
      }, timeoutMs);
      this.waiters.push({ match, resolve, reject, timer });
    });
  }
}

async function waitUntil<T>(
  probe: () => T | undefined | false,
  timeoutMs = 3000,
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = probe();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('waitUntil timed out');
}

async function startQueuedRun(server: TestServer, inboxes: WsInbox[]): Promise<void> {
  for (const inbox of inboxes) {
    await inbox.waitFor('queue:status');
  }
  await server.ctx.matchmaking.tick();
  server.clock.t = AUTO_START_MS;
  const started = inboxes.map((inbox) => inbox.waitFor('run:started'));
  await server.ctx.matchmaking.tick();
  await Promise.all(started);
}

async function jsonRequest(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function cleanupUser(userId: string): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const results = await db.runResult.findMany({
      where: { userId },
      select: { roomId: true },
    });
    await db.runResult.deleteMany({ where: { userId } });
    const roomIds = [...new Set(results.map((row) => row.roomId))];
    if (roomIds.length > 0) {
      await db.room.deleteMany({ where: { id: { in: roomIds } } });
    }
    await db.weaponUnlock.deleteMany({ where: { userId } });
    await db.playerProfile.deleteMany({ where: { userId } });
    try {
      await db.user.deleteMany({ where: { id: userId } });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`failed to clean up user ${userId}`);
}

async function waitForProfile(
  httpUrl: string,
  token: string,
  predicate: (body: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  let last: Record<string, unknown> = {};
  while (Date.now() - started < 3000) {
    const response = await jsonRequest(httpUrl, '/profile/me', {
      headers: { authorization: `Bearer ${token}` },
    });
    last = response.body;
    if (response.status === 200 && predicate(response.body)) {
      return response.body;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return last;
}

describe('18. End-to-end verification', () => {
  it(
    '18.1 runs the full solo guest flow without errors',
    { skip: !hasDb },
    async () => {
      const server = await startServer({
        persistRun: undefined,
        roomStore: undefined,
        players: undefined,
        waveConfig: [],
        config: soloRunConfig,
      });
      let userId = '';
      try {
        const guest = await jsonRequest(server.httpUrl, '/auth/guest', { method: 'POST' });
        assert.equal(guest.status, 200);
        userId = String(guest.body['userId'] ?? '');
        const token = String(guest.body['token'] ?? '');
        assert.ok(userId);
        assert.ok(token);

        const hub = await jsonRequest(server.httpUrl, '/profile/me', {
          headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(hub.status, 200);
        assert.equal(hub.body['rank'], 0);
        assert.equal(hub.body['metaCurrency'], 0);
        const unlocks = hub.body['weaponUnlocks'] as Array<{ weaponId: string }>;
        assert.ok(unlocks.some((row) => row.weaponId === 'pistol'));

        const ws = await connect(server, userId, token);
        const inbox = new WsInbox(ws);
        sendJson(ws, { type: 'queue:join', weaponId: 'pistol' });
        await startQueuedRun(server, [inbox]);

        const instance = server.ctx.rooms.getRoom(server.ctx.sessions.getByUserId(userId)?.roomId ?? '');
        assert.ok(instance);
        const player = instance.getPlayer(userId);
        assert.ok(player);
        instance.spawnMonster({ type: 'melee', x: player.x, y: player.y, hp: 1 });
        sendJson(ws, { type: 'input:shoot', angle: 0, t: 0 });
        const levelUp = await inbox.waitFor(
          'player:levelUp',
          4000,
          (message) => message.type === 'player:levelUp' && message.playerId === userId,
        );
        assert.equal(levelUp.type, 'player:levelUp');

        sendJson(ws, { type: 'player:chooseUpgrade', optionId: 'damage' });
        await waitUntil(() => instance.getCombatStats(userId)?.damage === 20 * 1.1);

        const afterUpgrade = instance.getPlayer(userId);
        assert.ok(afterUpgrade);
        for (let i = 0; i < 12; i += 1) {
          instance.spawnMonster({ type: 'melee', x: afterUpgrade.x, y: afterUpgrade.y, hp: 999 });
        }
        await inbox.waitFor(
          'player:died',
          4000,
          (message) => message.type === 'player:died' && message.playerId === userId,
        );

        const spectator = await waitUntil(() => {
          const snapshot = inbox.latestSnapshot();
          const self = snapshot?.players.find((entry) => entry.userId === userId);
          return self?.isDead ? snapshot : undefined;
        });
        assert.equal(spectator.players.find((entry) => entry.userId === userId)?.isDead, true);

        const ended = await inbox.waitFor('run:ended');
        assert.equal(ended.type, 'run:ended');
        if (ended.type === 'run:ended') {
          assert.equal(ended.results[0]?.userId, userId);
          assert.ok((ended.results[0]?.metaPointsEarned ?? 0) >= 0);
        }
        assert.equal(inbox.errors().length, 0);

        const updated = await waitForProfile(
          server.httpUrl,
          token,
          (body) => Number(body['totalRuns']) === 1,
        );
        assert.equal(updated['totalRuns'], 1);
        assert.equal(updated['rank'], gameConfig.rank.winDelta);
        assert.ok(Number(updated['metaCurrency']) >= 0);
        assert.ok(Number(updated['rank']) > Number(hub.body['rank']));
      } finally {
        if (userId) {
          await cleanupUser(userId);
        }
      }
    },
  );

  it('18.2 runs a 2-player group into the same room with live positions', async () => {
    const directory = new MemoryPlayerDirectory();
    directory.seed('a', { username: 'a', weapons: ['pistol'] });
    directory.seed('b', { username: 'b', weapons: ['shotgun'] });
    const server = await startServer({
      players: directory,
      waveConfig: [],
    });
    const wsA = await connect(server, 'a');
    const wsB = await connect(server, 'b');
    const inboxA = new WsInbox(wsA);
    const inboxB = new WsInbox(wsB);

    sendJson(wsA, { type: 'group:create' });
    const created = await inboxA.waitFor('group:state');
    assert.equal(created.type, 'group:state');
    if (created.type !== 'group:state') {
      return;
    }

    sendJson(wsB, { type: 'group:join', groupCode: created.groupCode });
    await inboxA.waitFor('group:state');
    const joined = await inboxB.waitFor('group:state');
    assert.equal(joined.type, 'group:state');
    if (joined.type === 'group:state') {
      assert.equal(joined.members.length, 2);
    }

    sendJson(wsB, { type: 'queue:join', weaponId: 'shotgun', groupId: created.groupId });
    await new Promise((resolve) => setTimeout(resolve, 30));
    sendJson(wsA, { type: 'queue:join', weaponId: 'pistol', groupId: created.groupId });
    await startQueuedRun(server, [inboxA, inboxB]);

    const matching = await waitUntil(() => {
      const snapA = inboxA.latestSnapshot();
      const snapB = inboxB.latestSnapshot();
      if (!snapA || !snapB || snapA.tick !== snapB.tick) {
        return undefined;
      }
      const idsA = snapA.players.map((player) => player.userId).sort();
      const idsB = snapB.players.map((player) => player.userId).sort();
      if (idsA.join() !== 'a,b' || idsB.join() !== 'a,b') {
        return undefined;
      }
      return { snapA, snapB };
    });
    for (const player of matching.snapA.players) {
      const other = matching.snapB.players.find((entry) => entry.userId === player.userId);
      assert.ok(other);
      assert.equal(other.x, player.x);
      assert.equal(other.y, player.y);
    }

    const before = matching.snapB.players.find((player) => player.userId === 'a');
    assert.ok(before);
    sendJson(wsA, { type: 'input:move', dx: 1, dy: 0, seq: 1, t: 0 });
    const moved = await waitUntil(() => {
      const snap = inboxB.latestSnapshot();
      const remote = snap?.players.find((player) => player.userId === 'a');
      return remote && remote.x > before.x ? remote : undefined;
    });
    assert.ok(moved.x > before.x);
  });

  it('18.3 auto-starts a solo queue within 10 seconds', async () => {
    const directory = new MemoryPlayerDirectory();
    directory.seed('solo', { username: 'solo', weapons: ['pistol'] });
    const server = await startServer({ players: directory, waveConfig: [] });
    const ws = await connect(server, 'solo');
    const inbox = new WsInbox(ws);
    sendJson(ws, { type: 'queue:join', weaponId: 'pistol' });
    await inbox.waitFor('queue:status');

    await server.ctx.matchmaking.tick();
    assert.equal(server.ctx.matchmaking.getWaitingRooms().length, 1);
    assert.equal(inbox.messages.some((message) => message.type === 'run:started'), false);

    server.clock.t = AUTO_START_MS - 1;
    await server.ctx.matchmaking.tick();
    assert.equal(server.ctx.matchmaking.getWaitingRooms().length, 1);

    server.clock.t = AUTO_START_MS;
    const started = inbox.waitFor('run:started');
    await server.ctx.matchmaking.tick();
    await started;
    assert.equal(server.ctx.matchmaking.getWaitingRooms().length, 0);
  });

  it('18.4 late-joins within 10s and opens a new room after the window', async () => {
    const directory = new MemoryPlayerDirectory();
    directory.seed('a', { username: 'a', weapons: ['pistol'] });
    directory.seed('b', { username: 'b', weapons: ['pistol'] });
    directory.seed('c', { username: 'c', weapons: ['pistol'] });
    const server = await startServer({ players: directory, waveConfig: [] });
    const wsA = await connect(server, 'a');
    const wsB = await connect(server, 'b');
    const wsC = await connect(server, 'c');
    const inboxA = new WsInbox(wsA);
    const inboxB = new WsInbox(wsB);
    const inboxC = new WsInbox(wsC);

    sendJson(wsA, { type: 'queue:join', weaponId: 'pistol' });
    await inboxA.waitFor('queue:status');
    await server.ctx.matchmaking.tick();
    const roomA = server.ctx.matchmaking.getWaitingRooms()[0]?.roomId;
    assert.ok(roomA);

    server.clock.t = 7_000;
    sendJson(wsB, { type: 'queue:join', weaponId: 'pistol' });
    await inboxB.waitFor('queue:status');
    await server.ctx.matchmaking.tick();
    const waitingAtSeven = server.ctx.matchmaking.getWaitingRooms();
    assert.equal(waitingAtSeven.length, 1);
    assert.equal(waitingAtSeven[0]?.roomId, roomA);
    assert.deepEqual(
      waitingAtSeven[0]?.players.map((player) => player.userId).sort(),
      ['a', 'b'],
    );

    server.clock.t = AUTO_START_MS;
    const startedA = inboxA.waitFor('run:started');
    const startedB = inboxB.waitFor('run:started');
    await server.ctx.matchmaking.tick();
    await startedA;
    await startedB;

    server.clock.t = 12_000;
    sendJson(wsC, { type: 'queue:join', weaponId: 'pistol' });
    await inboxC.waitFor('queue:status');
    await server.ctx.matchmaking.tick();
    const waitingAtTwelve = server.ctx.matchmaking.getWaitingRooms();
    assert.equal(waitingAtTwelve.length, 1);
    assert.equal(waitingAtTwelve[0]?.players[0]?.userId, 'c');
    assert.notEqual(waitingAtTwelve[0]?.roomId, roomA);
    assert.equal(
      inboxC.messages.some((message) => message.type === 'run:started'),
      false,
    );
  });

  it('18.5 resolves delayed shots on the server and mirrors them in snapshots', async () => {
    const directory = new MemoryPlayerDirectory();
    directory.seed('hunter', { username: 'hunter', weapons: ['pistol'] });
    const server = await startServer({ players: directory, waveConfig: [] });
    const ws = await connect(server, 'hunter');
    const inbox = new WsInbox(ws);
    sendJson(ws, { type: 'queue:join', weaponId: 'pistol' });
    await startQueuedRun(server, [inbox]);

    const instance = server.ctx.rooms.getRoom(
      server.ctx.sessions.getByUserId('hunter')?.roomId ?? '',
    );
    assert.ok(instance);
    const hunter = instance.getPlayer('hunter');
    assert.ok(hunter);
    const monster = instance.spawnMonster({ type: 'melee', x: hunter.x, y: hunter.y, hp: 40 });

    const before = await waitUntil(() => {
      const snapshot = inbox.latestSnapshot();
      const seen = snapshot?.monsters.find((entry) => entry.id === monster.id);
      return seen && seen.hp === 40 ? seen : undefined;
    });
    assert.equal(before.hp, 40);

    await new Promise((resolve) => setTimeout(resolve, 120));
    const stillFull = inbox.latestSnapshot()?.monsters.find((entry) => entry.id === monster.id);
    assert.equal(stillFull?.hp, 40);

    sendJson(ws, { type: 'input:shoot', angle: 0, t: 120 });
    const damaged = await waitUntil(() => {
      const snapshot = inbox.latestSnapshot();
      const seen = snapshot?.monsters.find((entry) => entry.id === monster.id);
      if (snapshot && !seen) {
        return { hp: 0 };
      }
      return seen && seen.hp < 40 ? seen : undefined;
    });
    assert.ok(damaged.hp < 40);
  });

  it(
    '18.8 persists rank and RunResult across disconnect and reconnect',
    { skip: !hasDb },
    async () => {
      const server = await startServer({
        persistRun: undefined,
        roomStore: undefined,
        players: undefined,
        waveConfig: [],
        config: soloRunConfig,
      });
      let userId = '';
      try {
        const guest = await jsonRequest(server.httpUrl, '/auth/guest', { method: 'POST' });
        userId = String(guest.body['userId'] ?? '');
        const token = String(guest.body['token'] ?? '');
        const before = await jsonRequest(server.httpUrl, '/profile/me', {
          headers: { authorization: `Bearer ${token}` },
        });
        const rankBefore = Number(before.body['rank']);

        const ws = await connect(server, userId, token);
        const inbox = new WsInbox(ws);
        sendJson(ws, { type: 'queue:join', weaponId: 'pistol' });
        await startQueuedRun(server, [inbox]);

        const instance = server.ctx.rooms.getRoom(
          server.ctx.sessions.getByUserId(userId)?.roomId ?? '',
        );
        assert.ok(instance);
        const player = instance.getPlayer(userId);
        assert.ok(player);
        for (let i = 0; i < 12; i += 1) {
          instance.spawnMonster({ type: 'melee', x: player.x, y: player.y, hp: 999 });
        }
        const ended = await inbox.waitFor('run:ended');
        assert.equal(ended.type, 'run:ended');

        ws.close();
        await new Promise((resolve) => ws.once('close', resolve));

        const after = await waitForProfile(
          server.httpUrl,
          token,
          (body) => Number(body['totalRuns']) === 1,
        );
        const rankAfter = Number(after['rank']);
        assert.equal(rankAfter, rankBefore + gameConfig.rank.winDelta);
        assert.ok(rankAfter > rankBefore);
        assert.equal(after['totalRuns'], 1);

        const row = await db.runResult.findFirst({ where: { userId } });
        assert.ok(row);
        assert.equal(row.rankBefore, rankBefore);
        assert.equal(row.rankAfter, rankAfter);
        assert.equal(row.userId, userId);
      } finally {
        if (userId) {
          await cleanupUser(userId);
        }
      }
    },
  );
});
