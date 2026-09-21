import { randomInt, randomUUID } from 'node:crypto';
import type { GroupMember } from '@shooter/shared';

export const GROUP_CODE_LENGTH = 6;
export const MAX_GROUP_SIZE = 10;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type GroupErrorCode = 'GROUP_FULL' | 'GROUP_NOT_FOUND';

export class GroupError extends Error {
  constructor(readonly code: GroupErrorCode) {
    super(code);
    this.name = 'GroupError';
  }
}

export interface Group {
  id: string;
  groupCode: string;
  leaderId: string;
  members: GroupMember[];
}

export interface LeaveGroupResult {
  group: Group | null;
  disbanded: boolean;
  remaining: GroupMember[];
  notifiedUserIds: string[];
}

export class GroupRegistry {
  private readonly groups = new Map<string, Group>();
  private readonly byCode = new Map<string, string>();
  private readonly byUser = new Map<string, string>();

  createGroup(leader: { userId: string; username: string }): Group {
    this.leaveGroup(leader.userId);

    const groupCode = this.allocateCode();
    const group: Group = {
      id: randomUUID(),
      groupCode,
      leaderId: leader.userId,
      members: [{ userId: leader.userId, username: leader.username, isLeader: true }],
    };
    this.groups.set(group.id, group);
    this.byCode.set(groupCode, group.id);
    this.byUser.set(leader.userId, group.id);
    return group;
  }

  joinGroup(groupCode: string, player: { userId: string; username: string }): Group {
    const code = groupCode.trim().toUpperCase();
    const groupId = this.byCode.get(code);
    const group = groupId ? this.groups.get(groupId) : undefined;
    if (!group) {
      throw new GroupError('GROUP_NOT_FOUND');
    }

    if (this.byUser.get(player.userId) === group.id) {
      return group;
    }

    if (group.members.length >= MAX_GROUP_SIZE) {
      throw new GroupError('GROUP_FULL');
    }

    this.leaveGroup(player.userId);
    group.members.push({
      userId: player.userId,
      username: player.username,
      isLeader: false,
    });
    this.byUser.set(player.userId, group.id);
    return group;
  }

  leaveGroup(userId: string): LeaveGroupResult {
    const groupId = this.byUser.get(userId);
    if (!groupId) {
      return { group: null, disbanded: false, remaining: [], notifiedUserIds: [] };
    }

    const group = this.groups.get(groupId);
    if (!group) {
      this.byUser.delete(userId);
      return { group: null, disbanded: false, remaining: [], notifiedUserIds: [] };
    }

    const isLeader = group.leaderId === userId;
    this.byUser.delete(userId);

    if (isLeader) {
      const remaining = group.members.filter((member) => member.userId !== userId);
      this.disband(group);
      return {
        group,
        disbanded: true,
        remaining,
        notifiedUserIds: remaining.map((member) => member.userId),
      };
    }

    group.members = group.members.filter((member) => member.userId !== userId);
    return {
      group,
      disbanded: false,
      remaining: group.members,
      notifiedUserIds: group.members.map((member) => member.userId),
    };
  }

  getGroup(groupId: string): Group | undefined {
    return this.groups.get(groupId);
  }

  getGroupByUser(userId: string): Group | undefined {
    const groupId = this.byUser.get(userId);
    return groupId ? this.groups.get(groupId) : undefined;
  }

  getGroupByCode(groupCode: string): Group | undefined {
    const groupId = this.byCode.get(groupCode.trim().toUpperCase());
    return groupId ? this.groups.get(groupId) : undefined;
  }

  private disband(group: Group): void {
    for (const member of group.members) {
      this.byUser.delete(member.userId);
    }
    this.groups.delete(group.id);
    this.byCode.delete(group.groupCode);
    group.members = [];
  }

  private allocateCode(): string {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const code = generateGroupCode();
      if (!this.byCode.has(code)) {
        return code;
      }
    }
    throw new Error('Unable to allocate a unique group code');
  }
}

export function generateGroupCode(): string {
  let code = '';
  for (let i = 0; i < GROUP_CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}
