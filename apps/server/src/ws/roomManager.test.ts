import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RoomManager } from './roomManager.js';

const players = [
  { userId: 'u1', username: 'alice', weaponId: 'pistol', rank: 0 },
];

describe('RoomManager', () => {
  it('creates, gets, and removes a room', () => {
    const manager = new RoomManager();
    const created = manager.createRoom('room-1', players, 42);

    assert.equal(created.roomId, 'room-1');
    assert.equal(created.seed, 42);
    assert.equal(manager.getRoom('room-1'), created);

    assert.equal(manager.removeRoom('room-1'), true);
    assert.equal(manager.getRoom('room-1'), undefined);
    assert.equal(manager.removeRoom('room-1'), false);
  });
});
