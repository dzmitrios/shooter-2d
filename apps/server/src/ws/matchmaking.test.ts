import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ServerMessage, WaveConfig } from '@shooter/shared';
import { AUTO_START_MS, MatchmakingQueue, MAX_ROOM_PLAYERS } from './matchmaking.js';
import { RoomManager } from './roomManager.js';
import { MemoryRoomStore } from './roomStore.js';

const waves: WaveConfig[] = [{ startSec: 0, endSec: 30, spawns: [] }];

function makePlayer(id: string, rank: number) {
  return { userId: id, username: id, weaponId: 'pistol', rank };
}

function createQueue(now: () => number) {
  const store = new MemoryRoomStore();
  const rooms = new RoomManager();
  const sent: { userId: string; message: ServerMessage }[] = [];
  const queue = new MatchmakingQueue({
    roomStore: store,
    roomManager: rooms,
    now,
    waveConfig: waves,
    broadcast: (userId, message) => {
      sent.push({ userId, message });
    },
  });
  return { queue, store, rooms, sent };
}

describe('MatchmakingQueue', () => {
  it('assigns similar-rank players to the same room and splits outliers', async () => {
    const { queue, store, rooms } = createQueue(() => 0);

    for (let i = 0; i < MAX_ROOM_PLAYERS; i++) {
      queue.enqueue({
        id: `s${i}`,
        players: [makePlayer(`near-${i}`, 100 + i)],
        rank: 100 + i,
      });
    }
    queue.enqueue({
      id: 'far',
      players: [makePlayer('far', 5000)],
      rank: 5000,
    });

    await queue.tick();

    const waiting = queue.getWaitingRooms();
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0]?.players.length, 1);
    assert.equal(waiting[0]?.players[0]?.userId, 'far');

    const running = [...store.rooms.values()].find((room) => room.status === 'IN_RUN');
    assert.ok(running);
    const nearRoom = rooms.getRoom(running.id);
    assert.ok(nearRoom);
    assert.equal(nearRoom.players.length, MAX_ROOM_PLAYERS);
    assert.ok(nearRoom.players.every((player) => player.userId.startsWith('near-')));
  });

  it('auto-starts a room when it reaches 10 players', async () => {
    const { queue, store, rooms, sent } = createQueue(() => 0);
    for (let i = 0; i < MAX_ROOM_PLAYERS; i++) {
      queue.enqueue({
        id: `p${i}`,
        players: [makePlayer(`p${i}`, i)],
        rank: i,
      });
    }

    await queue.tick();

    assert.equal(queue.getWaitingRooms().length, 0);
    const stored = [...store.rooms.values()];
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.status, 'IN_RUN');
    assert.ok(stored[0]?.startedAt);
    assert.ok(rooms.getRoom(stored[0]!.id));
    assert.equal(
      sent.filter((entry) => entry.message.type === 'run:started').length,
      MAX_ROOM_PLAYERS,
    );
  });

  it('auto-starts a room when the 10s timer elapses with fewer than 10 players', async () => {
    const clock = { t: 0 };
    const { queue, store, sent } = createQueue(() => clock.t);
    queue.enqueue({
      id: 'solo',
      players: [makePlayer('solo', 10)],
      rank: 10,
    });

    await queue.tick();
    assert.equal(queue.getWaitingRooms().length, 1);
    assert.equal([...store.rooms.values()][0]?.status, 'WAITING');

    clock.t = AUTO_START_MS;
    await queue.tick();

    assert.equal(queue.getWaitingRooms().length, 0);
    assert.equal([...store.rooms.values()][0]?.status, 'IN_RUN');
    assert.equal(sent.filter((entry) => entry.message.type === 'run:started').length, 1);
  });

  it('late-joins a WAITING room whose timer is under 10s instead of opening a new one', async () => {
    const clock = { t: 0 };
    const { queue } = createQueue(() => clock.t);

    queue.enqueue({ id: 'a', players: [makePlayer('a', 10)], rank: 10 });
    await queue.tick();
    const roomId = queue.getWaitingRooms()[0]?.roomId;
    assert.ok(roomId);

    clock.t = 5_000;
    queue.enqueue({ id: 'b', players: [makePlayer('b', 12)], rank: 12 });
    await queue.tick();

    const waiting = queue.getWaitingRooms();
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0]?.roomId, roomId);
    assert.deepEqual(
      waiting[0]?.players.map((player) => player.userId).sort(),
      ['a', 'b'],
    );
  });

  it('opens a new room when the late-join window has elapsed', async () => {
    const clock = { t: 0 };
    const { queue, store } = createQueue(() => clock.t);

    queue.enqueue({ id: 'a', players: [makePlayer('a', 10)], rank: 10 });
    await queue.tick();

    clock.t = AUTO_START_MS;
    queue.enqueue({ id: 'c', players: [makePlayer('c', 11)], rank: 11 });
    await queue.tick();

    const rooms = [...store.rooms.values()];
    assert.equal(rooms.length, 2);
    const running = rooms.find((room) => room.status === 'IN_RUN');
    const waiting = queue.getWaitingRooms();
    assert.ok(running);
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0]?.players[0]?.userId, 'c');
  });

  it('removes a pending player before room assignment on leave', async () => {
    const { queue } = createQueue(() => 0);
    queue.enqueue({ id: 'a', players: [makePlayer('a', 1)], rank: 1 });
    const removed = queue.leave('a');
    assert.ok(removed);
    await queue.tick();
    assert.equal(queue.getWaitingRooms().length, 0);
    assert.equal(queue.hasPlayer('a'), false);
  });
});
