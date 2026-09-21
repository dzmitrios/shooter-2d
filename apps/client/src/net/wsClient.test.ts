import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import type { ServerMessage } from '@shooter/shared';
import { WebSocket, WebSocketServer } from 'ws';
import { createSenders } from './senders.ts';
import { WsClient, type WebSocketConstructor } from './wsClient.ts';

const NodeWebSocket = WebSocket as unknown as WebSocketConstructor;

interface TestWsServer {
  url: string;
  wss: WebSocketServer;
  sockets: WebSocket[];
  close: () => Promise<void>;
}

const servers: TestWsServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server?.close();
  }
});

function wsUrl(addr: AddressInfo): string {
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
  return `ws://${host}:${addr.port}`;
}

async function startWsServer(
  onConnection?: (socket: WebSocket, req: http.IncomingMessage) => void,
): Promise<TestWsServer> {
  const httpServer = http.createServer();
  const wss = new WebSocketServer({ server: httpServer });
  const sockets: WebSocket[] = [];
  wss.on('connection', (socket, req) => {
    sockets.push(socket);
    onConnection?.(socket, req);
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, resolve);
  });
  const testServer: TestWsServer = {
    url: wsUrl(httpServer.address() as AddressInfo),
    wss,
    sockets,
    close: async () => {
      for (const socket of sockets) {
        socket.on('error', () => {});
        socket.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
  servers.push(testServer);
  return testServer;
}

function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error('timed out'));
        return;
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

describe('WsClient', () => {
  it('connects with a JWT query token and emits parsed server messages', async () => {
    let receivedToken: string | null = null;
    const server = await startWsServer((socket, req) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      receivedToken = url.searchParams.get('token');
      socket.send(JSON.stringify({ type: 'queue:status' } satisfies ServerMessage));
    });

    const messages: ServerMessage[] = [];
    const client = new WsClient({
      url: server.url,
      token: 'test-jwt',
      WebSocketImpl: NodeWebSocket,
      reconnectDelayMs: 20,
    });
    client.bus.on('queue:status', (message) => {
      messages.push(message);
    });
    client.connect();

    await waitUntil(() => messages.length === 1 && receivedToken !== null);
    assert.equal(receivedToken, 'test-jwt');
    assert.equal(messages[0]?.type, 'queue:status');
    client.disconnect();
  });

  it('reconnects after the server closes the socket', async () => {
    let connections = 0;
    const server = await startWsServer((socket) => {
      connections += 1;
      if (connections === 1) {
        socket.close();
      }
    });

    const client = new WsClient({
      url: server.url,
      token: 'jwt',
      WebSocketImpl: NodeWebSocket,
      reconnectDelayMs: 15,
    });
    client.connect();
    await waitUntil(() => connections >= 2);
    client.disconnect();
  });

  it('does not reconnect after disconnect()', async () => {
    let connections = 0;
    const server = await startWsServer(() => {
      connections += 1;
    });

    const client = new WsClient({
      url: server.url,
      token: 'jwt',
      WebSocketImpl: NodeWebSocket,
      reconnectDelayMs: 15,
    });
    client.connect();
    await waitUntil(() => connections === 1);
    client.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(connections, 1);
  });
});

describe('createSenders', () => {
  it('sends every Client→Server message type', async () => {
    const received: unknown[] = [];
    const server = await startWsServer((socket) => {
      socket.on('message', (data) => {
        received.push(JSON.parse(data.toString()));
      });
    });

    let opened = false;
    const client = new WsClient({
      url: server.url,
      token: 'jwt',
      WebSocketImpl: NodeWebSocket,
      onOpen: () => {
        opened = true;
      },
    });
    const senders = createSenders(client);
    client.connect();
    await waitUntil(() => opened);

    senders.queueJoin('pistol', 'g1');
    senders.queueLeave();
    senders.groupCreate();
    senders.groupJoin('ABCDEF');
    senders.groupLeave();
    senders.inputMove(1, 0, 3, 100);
    senders.inputShoot(1.2, 101);
    senders.chooseUpgrade('damage');

    await waitUntil(() => received.length === 8);
    assert.deepEqual(received, [
      { type: 'queue:join', weaponId: 'pistol', groupId: 'g1' },
      { type: 'queue:leave' },
      { type: 'group:create' },
      { type: 'group:join', groupCode: 'ABCDEF' },
      { type: 'group:leave' },
      { type: 'input:move', dx: 1, dy: 0, seq: 3, t: 100 },
      { type: 'input:shoot', angle: 1.2, t: 101 },
      { type: 'player:chooseUpgrade', optionId: 'damage' },
    ]);
    client.disconnect();
  });
});
