import type {
  GroupMember,
  MonsterState,
  PickupState,
  PlayerState,
  ProjectileState,
  RunPlayerResult,
  UpgradeOptionId,
  WaveConfig,
} from './entities.js';

export type ErrorCode =
  | 'UNKNOWN_MESSAGE_TYPE'
  | 'WEAPON_NOT_OWNED'
  | 'GROUP_FULL'
  | 'GROUP_NOT_FOUND';

// --- Client → Server ---

export interface QueueJoinMessage {
  type: 'queue:join';
  weaponId: string;
  groupId?: string;
}

export interface QueueLeaveMessage {
  type: 'queue:leave';
}

export interface GroupCreateMessage {
  type: 'group:create';
}

export interface GroupJoinMessage {
  type: 'group:join';
  groupCode: string;
}

export interface GroupLeaveMessage {
  type: 'group:leave';
}

export interface InputMoveMessage {
  type: 'input:move';
  dx: number;
  dy: number;
  seq: number;
  t: number;
}

export interface InputShootMessage {
  type: 'input:shoot';
  angle: number;
  t: number;
}

export interface PlayerChooseUpgradeMessage {
  type: 'player:chooseUpgrade';
  optionId: UpgradeOptionId;
}

export type ClientMessage =
  | QueueJoinMessage
  | QueueLeaveMessage
  | GroupCreateMessage
  | GroupJoinMessage
  | GroupLeaveMessage
  | InputMoveMessage
  | InputShootMessage
  | PlayerChooseUpgradeMessage;

// --- Server → Client ---

export interface QueueStatusMessage {
  type: 'queue:status';
}

export interface QueueCancelledMessage {
  type: 'queue:cancelled';
}

export interface GroupStateMessage {
  type: 'group:state';
  groupId: string;
  groupCode: string;
  members: GroupMember[];
}

export interface RunStartedMessage {
  type: 'run:started';
  seed: number;
  waveConfig: WaveConfig[];
}

export interface StateSnapshotMessage {
  type: 'state:snapshot';
  tick: number;
  players: PlayerState[];
  monsters: MonsterState[];
  projectiles: ProjectileState[];
  pickups: PickupState[];
}

export interface PlayerLevelUpMessage {
  type: 'player:levelUp';
  playerId: string;
  choices: [UpgradeOptionId, UpgradeOptionId, UpgradeOptionId];
}

export interface PlayerDiedMessage {
  type: 'player:died';
  playerId: string;
}

export interface RunEndedMessage {
  type: 'run:ended';
  results: RunPlayerResult[];
}

export interface ErrorMessage {
  type: 'error';
  code: ErrorCode;
  message?: string;
}

export type ServerMessage =
  | QueueStatusMessage
  | QueueCancelledMessage
  | GroupStateMessage
  | RunStartedMessage
  | StateSnapshotMessage
  | PlayerLevelUpMessage
  | PlayerDiedMessage
  | RunEndedMessage
  | ErrorMessage;
