import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GROUP_CODE_LENGTH, GroupError, GroupRegistry, MAX_GROUP_SIZE } from './groupRegistry.js';

function player(n: number): { userId: string; username: string } {
  return { userId: `u${n}`, username: `user${n}` };
}

describe('GroupRegistry', () => {
  it('creates a group with a unique 6-char groupCode and the sender as leader', () => {
    const registry = new GroupRegistry();
    const group = registry.createGroup(player(1));

    assert.equal(group.groupCode.length, GROUP_CODE_LENGTH);
    assert.match(group.groupCode, /^[A-Z0-9]{6}$/);
    assert.equal(group.leaderId, 'u1');
    assert.deepEqual(group.members, [{ userId: 'u1', username: 'user1', isLeader: true }]);
    assert.equal(registry.getGroup(group.id), group);
  });

  it('allocates unique group codes', () => {
    const registry = new GroupRegistry();
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      codes.add(registry.createGroup(player(i)).groupCode);
    }
    assert.equal(codes.size, 200);
  });

  it('joins by code and rejects an 11th member', () => {
    const registry = new GroupRegistry();
    const group = registry.createGroup(player(0));
    for (let i = 1; i < MAX_GROUP_SIZE; i++) {
      registry.joinGroup(group.groupCode, player(i));
    }
    assert.equal(registry.getGroup(group.id)?.members.length, MAX_GROUP_SIZE);
    assert.throws(() => registry.joinGroup(group.groupCode, player(10)), (err: unknown) => {
      return err instanceof GroupError && err.code === 'GROUP_FULL';
    });
  });

  it('returns GROUP_NOT_FOUND for an unknown code', () => {
    const registry = new GroupRegistry();
    assert.throws(() => registry.joinGroup('ZZZZZZ', player(1)), (err: unknown) => {
      return err instanceof GroupError && err.code === 'GROUP_NOT_FOUND';
    });
  });

  it('disbands the group when the leader leaves', () => {
    const registry = new GroupRegistry();
    const group = registry.createGroup(player(1));
    registry.joinGroup(group.groupCode, player(2));
    const result = registry.leaveGroup('u1');

    assert.equal(result.disbanded, true);
    assert.equal(registry.getGroup(group.id), undefined);
    assert.equal(registry.getGroupByUser('u2'), undefined);
    assert.deepEqual(result.notifiedUserIds, ['u2']);
  });

  it('removes a non-leader without disbanding', () => {
    const registry = new GroupRegistry();
    const group = registry.createGroup(player(1));
    registry.joinGroup(group.groupCode, player(2));
    const result = registry.leaveGroup('u2');

    assert.equal(result.disbanded, false);
    assert.equal(registry.getGroup(group.id)?.members.length, 1);
    assert.equal(registry.getGroupByUser('u2'), undefined);
    assert.equal(registry.getGroupByUser('u1')?.id, group.id);
  });
});
