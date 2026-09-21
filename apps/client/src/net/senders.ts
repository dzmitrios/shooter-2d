import type {
  ClientMessage,
  GroupCreateMessage,
  GroupJoinMessage,
  GroupLeaveMessage,
  InputMoveMessage,
  InputShootMessage,
  PlayerChooseUpgradeMessage,
  QueueJoinMessage,
  QueueLeaveMessage,
  UpgradeOptionId,
} from '@shooter/shared';

export interface MessageSender {
  send(message: ClientMessage): void;
}

export interface ClientSenders {
  queueJoin(weaponId: string, groupId?: string): void;
  queueLeave(): void;
  groupCreate(): void;
  groupJoin(groupCode: string): void;
  groupLeave(): void;
  inputMove(dx: number, dy: number, seq: number, t: number): void;
  inputShoot(angle: number, t: number): void;
  chooseUpgrade(optionId: UpgradeOptionId): void;
}

export function createSenders(transport: MessageSender): ClientSenders {
  return {
    queueJoin(weaponId: string, groupId?: string): void {
      const message: QueueJoinMessage = { type: 'queue:join', weaponId };
      if (groupId !== undefined) {
        message.groupId = groupId;
      }
      transport.send(message);
    },
    queueLeave(): void {
      const message: QueueLeaveMessage = { type: 'queue:leave' };
      transport.send(message);
    },
    groupCreate(): void {
      const message: GroupCreateMessage = { type: 'group:create' };
      transport.send(message);
    },
    groupJoin(groupCode: string): void {
      const message: GroupJoinMessage = { type: 'group:join', groupCode };
      transport.send(message);
    },
    groupLeave(): void {
      const message: GroupLeaveMessage = { type: 'group:leave' };
      transport.send(message);
    },
    inputMove(dx: number, dy: number, seq: number, t: number): void {
      const message: InputMoveMessage = { type: 'input:move', dx, dy, seq, t };
      transport.send(message);
    },
    inputShoot(angle: number, t: number): void {
      const message: InputShootMessage = { type: 'input:shoot', angle, t };
      transport.send(message);
    },
    chooseUpgrade(optionId: UpgradeOptionId): void {
      const message: PlayerChooseUpgradeMessage = {
        type: 'player:chooseUpgrade',
        optionId,
      };
      transport.send(message);
    },
  };
}
