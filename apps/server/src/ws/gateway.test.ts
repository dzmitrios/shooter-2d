import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { afterEach, describe, it } from 'node:test';
import type { ServerMessage } from '@shooter/shared';
import { WebSocket } from 'ws';
import { createApp } from '../rest/app.js';
import { signToken } from '../rest/jwt.js';
import { createGameContext, type GameContextOptions } from './context.js';
import { attachWebSocket } from './gateway.js';
import { InputRateLimiter } from './inputRateLimiter.js';
import { MemoryPlayerDirectory } from './playerDirectory.js';
import { MemoryRoomStore } from './roomStore.js';

process.env['JWT_SECRET'] ??= 'test-secret';

interface TestServer {
  port: number;
  ctx: ReturnType<typeof createGameContext>;
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

async function startServer(
  directory?: MemoryPlayerDirectory,
  extra: Pick<GameContextOptions, 'inputRateLimiter'> = {},
): Promise<TestServer> {
  const players = directory ?? new MemoryPlayerDirectory();
  const httpServer = http.createServer(createApp());
  const ctx = createGameContext({
    players,
    roomStore: new MemoryRoomStore(),
    persistRun: async () => {},
    ...extra,
  });
  attachWebSocket(httpServer, ctx);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const port = (httpServer.address() as AddressInfo).port;
  const sockets: WebSocket[] = [];
  const testServer: TestServer = {
    port,
    ctx,
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

function connect(server: TestServer, userId: string, useHeader = false): Promise<WebSocket> {
  const token = signToken(userId);
  const ws = useHeader
    ? new WebSocket(`ws://127.0.0.1:${server.port}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    : new WebSocket(`ws://127.0.0.1:${server.port}/?token=${encodeURIComponent(token)}`);
  ws.on('error', () => {});
  server.sockets.push(ws);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitFor(ws: WebSocket, type: ServerMessage['type'], timeoutMs = 2000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`timed out waiting for ${type}`));
    }, timeoutMs);
    const onMessage = (data: Buffer) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      if (message.type === type) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(message);
      }
    };
    ws.on('message', onMessage);
  });
}

function sendJson(ws: WebSocket, payload: unknown): void {
  ws.send(JSON.stringify(payload));
}

describe('WebSocket gateway', () => {
  it('accepts a connection with a valid query-param token and rejects one without', async () => {
    const server = await startServer();
    const ws = await connect(server, 'user-valid');
    assert.equal(ws.readyState, WebSocket.OPEN);

    const rejected = new WebSocket(`ws://127.0.0.1:${server.port}`);
    rejected.on('error', () => {});
    server.sockets.push(rejected);
    const response = await once(rejected, 'unexpected-response');
    const res = response[1] as { statusCode: number };
    assert.equal(res.statusCode, 401);
  });

  it('accepts a connection authenticated via Authorization header', async () => {
    const server = await startServer();
    const ws = await connect(server, 'user-header', true);
    assert.equal(ws.readyState, WebSocket.OPEN);
  });

  it('creates a group and returns group:state with a 6-char code', async () => {
    const directory = new MemoryPlayerDirectory();
    directory.seed('leader', { username: 'leader' });
    const server = await startServer(directory);
    const ws = await connect(server, 'leader');
    sendJson(ws, { type: 'group:create' });
    const state = await waitFor(ws, 'group:state');
    assert.equal(state.type, 'group:state');
    if (state.type !== 'group:state') {
      return;
    }
    assert.equal(state.groupCode.length, 6);
    assert.equal(state.members.length, 1);
    assert.equal(state.members[0]?.isLeader, true);
    assert.ok(server.ctx.groups.getGroup(state.groupId));
  });

  it('broadcasts group:state on join and returns GROUP_FULL / GROUP_NOT_FOUND', async () => {
    const directory = new MemoryPlayerDirectory();
    directory.seed('a', { username: 'a' });
    directory.seed('b', { username: 'b' });
    directory.seed('c', { username: 'c' });
    const server = await startServer(directory);

    const leader = await connect(server, 'a');
    sendJson(leader, { type: 'group:create' });
    const created = await waitFor(leader, 'group:state');
    assert.equal(created.type, 'group:state');
    if (created.type !== 'group:state') {
      return;
    }

    const member = await connect(server, 'b');
    const joinedP = waitFor(member, 'group:state');
    const leaderUpdateP = waitFor(leader, 'group:state');
    sendJson(member, { type: 'group:join', groupCode: created.groupCode });
    const joined = await joinedP;
    const leaderUpdate = await leaderUpdateP;
    assert.equal(joined.type, 'group:state');
    assert.equal(leaderUpdate.type, 'group:state');
    if (joined.type === 'group:state') {
      assert.equal(joined.members.length, 2);
    }

    sendJson(member, { type: 'group:join', groupCode: 'NOPE00' });
    const missing = await waitFor(member, 'error');
    assert.equal(missing.type, 'error');
    if (missing.type === 'error') {
      assert.equal(missing.code, 'GROUP_NOT_FOUND');
    }

    const group = server.ctx.groups.getGroup(created.groupId);
    assert.ok(group);
    for (let i = 2; i < 10; i++) {
      const userId = `fill-${i}`;
      directory.seed(userId, { username: userId });
      server.ctx.groups.joinGroup(created.groupCode, { userId, username: userId });
    }
    const extra = await connect(server, 'c');
    sendJson(extra, { type: 'group:join', groupCode: created.groupCode });
    const full = await waitFor(extra, 'error');
    assert.equal(full.type, 'error');
    if (full.type === 'error') {
      assert.equal(full.code, 'GROUP_FULL');
    }
  });

  it('disbands the group when the leader leaves', async () => {
    const directory = new MemoryPlayerDirectory();
    directory.seed('a', { username: 'a' });
    directory.seed('b', { username: 'b' });
    const server = await startServer(directory);
    const leader = await connect(server, 'a');
    const member = await connect(server, 'b');

    sendJson(leader, { type: 'group:create' });
    const created = await waitFor(leader, 'group:state');
    assert.equal(created.type, 'group:state');
    if (created.type !== 'group:state') {
      return;
    }
    const memberJoined = waitFor(member, 'group:state');
    const leaderUpdated = waitFor(leader, 'group:state');
    sendJson(member, { type: 'group:join', groupCode: created.groupCode });
    await memberJoined;
    await leaderUpdated;

    const disbandedP = waitFor(member, 'group:state');
    sendJson(leader, { type: 'group:leave' });
    const disbanded = await disbandedP;
    assert.equal(disbanded.type, 'group:state');
    if (disbanded.type === 'group:state') {
      assert.equal(disbanded.members.length, 0);
    }
    assert.equal(server.ctx.groups.getGroup(created.groupId), undefined);
  });

  it('responds with UNKNOWN_MESSAGE_TYPE for unknown types', async () => {
    const server = await startServer();
    const ws = await connect(server, 'router-user');
    sendJson(ws, { type: 'nope' });
    const error = await waitFor(ws, 'error');
    assert.equal(error.type, 'error');
    if (error.type === 'error') {
      assert.equal(error.code, 'UNKNOWN_MESSAGE_TYPE');
    }
  });

  it('queues a player who owns the weapon and rejects WEAPON_NOT_OWNED', async () => {
    const directory = new MemoryPlayerDirectory();
    directory.seed('queued', { username: 'queued', weapons: ['pistol'] });
    directory.seed('broke', { username: 'broke', weapons: ['pistol'] });
    const server = await startServer(directory);

    const ws = await connect(server, 'queued');
    sendJson(ws, { type: 'queue:join', weaponId: 'pistol' });
    const status = await waitFor(ws, 'queue:status');
    assert.equal(status.type, 'queue:status');
    assert.equal(server.ctx.matchmaking.hasPlayer('queued'), true);

    sendJson(ws, { type: 'queue:join', weaponId: 'sniper' });
    // already queued, but unowned weapon should still be rejected if they weren't queued...
    // they are queued; handler returns queue:status before re-validating? 
    // current code validates ownership first, so sniper yields WEAPON_NOT_OWNED
    const denied = await waitFor(ws, 'error');
    assert.equal(denied.type, 'error');
    if (denied.type === 'error') {
      assert.equal(denied.code, 'WEAPON_NOT_OWNED');
    }

    const other = await connect(server, 'broke');
    sendJson(other, { type: 'queue:join', weaponId: 'sniper' });
    const otherDenied = await waitFor(other, 'error');
    assert.equal(otherDenied.type, 'error');
    if (otherDenied.type === 'error') {
      assert.equal(otherDenied.code, 'WEAPON_NOT_OWNED');
    }
    assert.equal(server.ctx.matchmaking.hasPlayer('broke'), false);
  });

  it('cancels queue:leave before room assignment', async () => {
    const directory = new MemoryPlayerDirectory();
    directory.seed('leaver', { username: 'leaver', weapons: ['pistol'] });
    const server = await startServer(directory);
    const ws = await connect(server, 'leaver');
    sendJson(ws, { type: 'queue:join', weaponId: 'pistol' });
    await waitFor(ws, 'queue:status');
    sendJson(ws, { type: 'queue:leave' });
    const cancelled = await waitFor(ws, 'queue:cancelled');
    assert.equal(cancelled.type, 'queue:cancelled');
    assert.equal(server.ctx.matchmaking.hasPlayer('leaver'), false);
  });

  it('removes a disconnected player from the queue and from a group', async () => {
    const directory = new MemoryPlayerDirectory();
    directory.seed('leader', { username: 'leader', weapons: ['pistol'] });
    directory.seed('member', { username: 'member', weapons: ['pistol'] });
    const server = await startServer(directory);
    const leader = await connect(server, 'leader');
    const member = await connect(server, 'member');

    sendJson(leader, { type: 'group:create' });
    const created = await waitFor(leader, 'group:state');
    assert.equal(created.type, 'group:state');
    if (created.type !== 'group:state') {
      return;
    }
    const memberJoined = waitFor(member, 'group:state');
    const leaderUpdated = waitFor(leader, 'group:state');
    sendJson(member, { type: 'group:join', groupCode: created.groupCode });
    await memberJoined;
    await leaderUpdated;

    const leaderQueued = waitFor(leader, 'queue:status');
    const memberQueued = waitFor(member, 'queue:status');
    sendJson(leader, { type: 'queue:join', weaponId: 'pistol', groupId: created.groupId });
    await leaderQueued;
    await memberQueued;

    member.close();
    await once(member, 'close');
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(server.ctx.groups.getGroup(created.groupId)?.members.some((m) => m.userId === 'member'), false);
    assert.equal(server.ctx.matchmaking.hasPlayer('member'), false);
  });

  it('marks an in-run player disconnected', async () => {
    const directory = new MemoryPlayerDirectory();
    directory.seed('runner', { username: 'runner', weapons: ['pistol'] });
    const server = await startServer(directory);
    const ws = await connect(server, 'runner');
    sendJson(ws, { type: 'queue:join', weaponId: 'pistol' });
    await waitFor(ws, 'queue:status');
    await server.ctx.matchmaking.tick();
    const waiting = server.ctx.matchmaking.getWaitingRooms()[0];
    assert.ok(waiting);
    const instance = server.ctx.rooms.createRoom(waiting.roomId, waiting.players, 1);
    const session = server.ctx.sessions.getByUserId('runner');
    assert.ok(session);
    session.roomId = waiting.roomId;

    ws.close();
    await once(ws, 'close');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(instance.disconnected.has('runner'), true);
  });

  it('sends state:snapshot to clients during a run', async () => {
    const directory = new MemoryPlayerDirectory();
    directory.seed('runner', { username: 'runner', weapons: ['pistol'] });
    const server = await startServer(directory);
    const ws = await connect(server, 'runner');
    sendJson(ws, { type: 'queue:join', weaponId: 'pistol' });
    await waitFor(ws, 'queue:status');
    await server.ctx.matchmaking.tick();
    const waiting = server.ctx.matchmaking.getWaitingRooms()[0];
    assert.ok(waiting);
    const snapshot = waitFor(ws, 'state:snapshot');
    server.ctx.rooms.createRoom(waiting.roomId, waiting.players, 1);
    const session = server.ctx.sessions.getByUserId('runner');
    assert.ok(session);
    session.roomId = waiting.roomId;
    const message = await snapshot;
    assert.equal(message.type, 'state:snapshot');
    if (message.type !== 'state:snapshot') {
      return;
    }
    assert.ok(message.players.some((entry) => entry.userId === 'runner'));
  });

  it('silently drops excess input:* messages over the per-second limit', async () => {
    const directory = new MemoryPlayerDirectory();
    directory.seed('spammer', { username: 'spammer', weapons: ['pistol'] });
    const limiter = new InputRateLimiter({ maxPerSecond: 3, violationThreshold: 10 }, () => 0);
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };

    try {
      const server = await startServer(directory, { inputRateLimiter: limiter });
      const ws = await connect(server, 'spammer');
      sendJson(ws, { type: 'queue:join', weaponId: 'pistol' });
      await waitFor(ws, 'queue:status');
      await server.ctx.matchmaking.tick();
      const waiting = server.ctx.matchmaking.getWaitingRooms()[0];
      assert.ok(waiting);
      const instance = server.ctx.rooms.createRoom(waiting.roomId, waiting.players, 1);
      const session = server.ctx.sessions.getByUserId('spammer');
      assert.ok(session);
      session.roomId = waiting.roomId;

      for (let seq = 1; seq <= 8; seq++) {
        sendJson(ws, { type: 'input:move', dx: 1, dy: 0, seq });
      }
      await new Promise((resolve) => setTimeout(resolve, 50));

      const player = instance.getPlayer('spammer');
      assert.ok(player);
      assert.equal(player.seq, 3);
      assert.equal(ws.readyState, WebSocket.OPEN);
      assert.ok(warnings.some((line) => line.includes('input rate limit exceeded')));
    } finally {
      console.warn = originalWarn;
    }
  });

  it('closes the connection after repeated rate-limit violations and removes the player from the room', async () => {
    let now = 0;
    const directory = new MemoryPlayerDirectory();
    directory.seed('kicked', { username: 'kicked', weapons: ['pistol'] });
    const limiter = new InputRateLimiter({ maxPerSecond: 2, violationThreshold: 2 }, () => now);
    const server = await startServer(directory, { inputRateLimiter: limiter });
    const ws = await connect(server, 'kicked');
    sendJson(ws, { type: 'queue:join', weaponId: 'pistol' });
    await waitFor(ws, 'queue:status');
    await server.ctx.matchmaking.tick();
    const waiting = server.ctx.matchmaking.getWaitingRooms()[0];
    assert.ok(waiting);
    const instance = server.ctx.rooms.createRoom(waiting.roomId, waiting.players, 1);
    const session = server.ctx.sessions.getByUserId('kicked');
    assert.ok(session);
    session.roomId = waiting.roomId;

    for (let seq = 1; seq <= 4; seq++) {
      sendJson(ws, { type: 'input:move', dx: 1, dy: 0, seq });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(ws.readyState, WebSocket.OPEN);

    now = 1000;
    const closed = once(ws, 'close');
    for (let seq = 5; seq <= 8; seq++) {
      sendJson(ws, { type: 'input:move', dx: 1, dy: 0, seq });
    }
    await closed;
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.notEqual(ws.readyState, WebSocket.OPEN);
    assert.equal(instance.disconnected.has('kicked'), true);
    assert.equal(server.ctx.sessions.getByUserId('kicked'), undefined);
  });
});
