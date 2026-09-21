import type { GroupStateMessage } from '@shooter/shared';
import type { GameContext } from './context.js';
import { GroupError } from './groupRegistry.js';
import { averageSlotRank, type QueueSlotPlayer } from './matchmaking.js';
import { send, sendError } from './send.js';
import type { PlayerSession } from './sessionRegistry.js';

export async function handleMessage(
  ctx: GameContext,
  session: PlayerSession,
  raw: string,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendError(session.socket, 'UNKNOWN_MESSAGE_TYPE');
    return;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { type?: unknown }).type !== 'string'
  ) {
    sendError(session.socket, 'UNKNOWN_MESSAGE_TYPE');
    return;
  }

  const type = (parsed as { type: string }).type;
  switch (type) {
    case 'group:create':
      handleGroupCreate(ctx, session);
      return;
    case 'group:join':
      handleGroupJoin(ctx, session, parsed);
      return;
    case 'group:leave':
      handleGroupLeave(ctx, session);
      return;
    case 'queue:join':
      await handleQueueJoin(ctx, session, parsed);
      return;
    case 'queue:leave':
      handleQueueLeave(ctx, session);
      return;
    case 'input:move':
      handleInputMove(ctx, session, parsed);
      return;
    case 'input:shoot':
      handleInputShoot(ctx, session, parsed);
      return;
    case 'player:chooseUpgrade':
      return;
    default:
      sendError(session.socket, 'UNKNOWN_MESSAGE_TYPE');
  }
}

function handleGroupCreate(ctx: GameContext, session: PlayerSession): void {
  const previous = ctx.groups.getGroupByUser(session.userId);
  if (previous) {
    cancelQueuedSlot(ctx, session.userId);
  }
  const group = ctx.groups.createGroup({
    userId: session.userId,
    username: session.username,
  });
  session.groupId = group.id;
  send(session.socket, toGroupState(group));
}

function handleGroupJoin(ctx: GameContext, session: PlayerSession, raw: unknown): void {
  const groupCode =
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as { groupCode?: unknown }).groupCode === 'string'
      ? (raw as { groupCode: string }).groupCode
      : '';

  try {
    const previous = ctx.groups.getGroupByUser(session.userId);
    if (previous) {
      cancelQueuedSlot(ctx, session.userId);
    }
    const group = ctx.groups.joinGroup(groupCode, {
      userId: session.userId,
      username: session.username,
    });
    session.groupId = group.id;
    broadcastGroupState(ctx, group);
  } catch (err) {
    if (err instanceof GroupError) {
      sendError(session.socket, err.code);
      return;
    }
    throw err;
  }
}

function handleGroupLeave(ctx: GameContext, session: PlayerSession): void {
  cancelQueuedSlot(ctx, session.userId);
  const result = ctx.groups.leaveGroup(session.userId);
  session.groupId = undefined;
  if (!result.group) {
    return;
  }

  if (result.disbanded) {
    const emptyState: GroupStateMessage = {
      type: 'group:state',
      groupId: result.group.id,
      groupCode: result.group.groupCode,
      members: [],
    };
    for (const userId of result.notifiedUserIds) {
      const memberSession = ctx.sessions.getByUserId(userId);
      if (memberSession) {
        memberSession.groupId = undefined;
        send(memberSession.socket, emptyState);
      }
    }
    return;
  }

  broadcastGroupState(ctx, result.group);
}

async function handleQueueJoin(
  ctx: GameContext,
  session: PlayerSession,
  raw: unknown,
): Promise<void> {
  const weaponId =
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as { weaponId?: unknown }).weaponId === 'string'
      ? (raw as { weaponId: string }).weaponId
      : '';
  const groupId =
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as { groupId?: unknown }).groupId === 'string'
      ? (raw as { groupId: string }).groupId
      : undefined;

  if (!weaponId || !(await ctx.players.ownsWeapon(session.userId, weaponId))) {
    sendError(session.socket, 'WEAPON_NOT_OWNED');
    return;
  }

  session.weaponId = weaponId;

  if (session.roomId && ctx.rooms.getRoom(session.roomId)) {
    return;
  }

  const group = groupId
    ? ctx.groups.getGroup(groupId)
    : ctx.groups.getGroupByUser(session.userId);

  if (groupId && (!group || group.id !== groupId)) {
    sendError(session.socket, 'GROUP_NOT_FOUND');
    return;
  }

  if (group && group.leaderId !== session.userId) {
    return;
  }

  if (ctx.matchmaking.hasPlayer(session.userId)) {
    send(session.socket, { type: 'queue:status' });
    return;
  }

  if (group) {
    const players: QueueSlotPlayer[] = [];
    for (const member of group.members) {
      const memberSession = ctx.sessions.getByUserId(member.userId);
      const memberWeaponId =
        member.userId === session.userId
          ? weaponId
          : (memberSession?.weaponId ?? (await ctx.players.defaultWeaponId(member.userId)));
      if (
        !memberWeaponId ||
        !(await ctx.players.ownsWeapon(member.userId, memberWeaponId))
      ) {
        sendError(session.socket, 'WEAPON_NOT_OWNED');
        return;
      }
      players.push({
        userId: member.userId,
        username: member.username,
        weaponId: memberWeaponId,
        rank: await ctx.players.getRank(member.userId),
      });
    }

    ctx.matchmaking.enqueue({
      id: group.id,
      players,
      rank: averageSlotRank(players),
      groupId: group.id,
    });
    for (const player of players) {
      ctx.sessions.send(player.userId, { type: 'queue:status' });
    }
    return;
  }

  const rank = await ctx.players.getRank(session.userId);
  ctx.matchmaking.enqueue({
    id: session.userId,
    players: [
      {
        userId: session.userId,
        username: session.username,
        weaponId,
        rank,
      },
    ],
    rank,
  });
  send(session.socket, { type: 'queue:status' });
}

function handleInputMove(ctx: GameContext, session: PlayerSession, raw: unknown): void {
  const instance = session.roomId ? ctx.rooms.getRoom(session.roomId) : undefined;
  if (!instance) {
    return;
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    typeof (raw as { dx?: unknown }).dx !== 'number' ||
    typeof (raw as { dy?: unknown }).dy !== 'number' ||
    typeof (raw as { seq?: unknown }).seq !== 'number'
  ) {
    return;
  }
  const { dx, dy, seq } = raw as { dx: number; dy: number; seq: number };
  instance.handleMove(session.userId, dx, dy, seq);
}

function handleInputShoot(ctx: GameContext, session: PlayerSession, raw: unknown): void {
  const instance = session.roomId ? ctx.rooms.getRoom(session.roomId) : undefined;
  if (!instance) {
    return;
  }
  if (typeof raw !== 'object' || raw === null || typeof (raw as { angle?: unknown }).angle !== 'number') {
    return;
  }
  instance.handleShoot(session.userId, (raw as { angle: number }).angle);
}

function handleQueueLeave(ctx: GameContext, session: PlayerSession): void {
  if (session.roomId && ctx.rooms.getRoom(session.roomId)) {
    return;
  }

  const slot = ctx.matchmaking.leave(session.userId);
  if (!slot) {
    return;
  }
  if (session.roomId && !ctx.rooms.getRoom(session.roomId)) {
    session.roomId = undefined;
  }
  for (const player of slot.players) {
    const memberSession = ctx.sessions.getByUserId(player.userId);
    if (memberSession && memberSession.roomId && !ctx.rooms.getRoom(memberSession.roomId)) {
      memberSession.roomId = undefined;
    }
    ctx.sessions.send(player.userId, { type: 'queue:cancelled' });
  }
}

export function handleDisconnect(ctx: GameContext, session: PlayerSession): void {
  if (session.roomId) {
    const instance = ctx.rooms.getRoom(session.roomId);
    if (instance) {
      instance.markDisconnected(session.userId);
      ctx.groups.leaveGroup(session.userId);
      return;
    }
  }

  const slot = ctx.matchmaking.leave(session.userId);
  if (slot) {
    for (const player of slot.players) {
      if (player.userId === session.userId) {
        continue;
      }
      const memberSession = ctx.sessions.getByUserId(player.userId);
      if (memberSession && memberSession.roomId && !ctx.rooms.getRoom(memberSession.roomId)) {
        memberSession.roomId = undefined;
      }
      ctx.sessions.send(player.userId, { type: 'queue:cancelled' });
    }
  }

  const result = ctx.groups.leaveGroup(session.userId);
  if (!result.group) {
    return;
  }
  if (result.disbanded) {
    const emptyState: GroupStateMessage = {
      type: 'group:state',
      groupId: result.group.id,
      groupCode: result.group.groupCode,
      members: [],
    };
    for (const userId of result.notifiedUserIds) {
      const memberSession = ctx.sessions.getByUserId(userId);
      if (memberSession) {
        memberSession.groupId = undefined;
        send(memberSession.socket, emptyState);
      }
    }
    return;
  }
  broadcastGroupState(ctx, result.group);
}

function cancelQueuedSlot(ctx: GameContext, userId: string): void {
  const slot = ctx.matchmaking.leave(userId);
  if (!slot) {
    return;
  }
  for (const player of slot.players) {
    const memberSession = ctx.sessions.getByUserId(player.userId);
    if (memberSession && memberSession.roomId && !ctx.rooms.getRoom(memberSession.roomId)) {
      memberSession.roomId = undefined;
    }
    ctx.sessions.send(player.userId, { type: 'queue:cancelled' });
  }
}

function broadcastGroupState(
  ctx: GameContext,
  group: { id: string; groupCode: string; members: GroupStateMessage['members'] },
): void {
  const message = toGroupState(group);
  for (const member of group.members) {
    const memberSession = ctx.sessions.getByUserId(member.userId);
    if (memberSession) {
      memberSession.groupId = group.id;
      send(memberSession.socket, message);
    }
  }
}

function toGroupState(group: {
  id: string;
  groupCode: string;
  members: GroupStateMessage['members'];
}): GroupStateMessage {
  return {
    type: 'group:state',
    groupId: group.id,
    groupCode: group.groupCode,
    members: group.members,
  };
}
