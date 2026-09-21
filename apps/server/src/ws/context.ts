import type { WaveConfig } from '@shooter/shared';
import waves from '../config/waves.json' with { type: 'json' };
import { persistRunToDb, type PersistRun } from '../game/runPersistence.js';
import { GroupRegistry } from './groupRegistry.js';
import { MatchmakingQueue } from './matchmaking.js';
import {
  prismaPlayerDirectory,
  type PlayerDirectory,
} from './playerDirectory.js';
import { RoomManager } from './roomManager.js';
import { prismaRoomStore, type RoomStore } from './roomStore.js';
import { SessionRegistry } from './sessionRegistry.js';

export interface GameContext {
  sessions: SessionRegistry;
  groups: GroupRegistry;
  rooms: RoomManager;
  matchmaking: MatchmakingQueue;
  players: PlayerDirectory;
}

export interface GameContextOptions {
  players?: PlayerDirectory;
  roomStore?: RoomStore;
  now?: () => number;
  waveConfig?: WaveConfig[];
  persistRun?: PersistRun;
}

export function createGameContext(options: GameContextOptions = {}): GameContext {
  // Info about player sessions (user, weapon, room, group, socket)
  const sessions = new SessionRegistry();
  // Info about groups (leader, members, groupCode)
  const groups = new GroupRegistry();
  const players = options.players ?? prismaPlayerDirectory;
  
  // Info about rooms (players, startedAt)
  const rooms = new RoomManager({
    autoStart: true,
    broadcast: (userId, message) => {
      sessions.send(userId, message);
    },
    persistRun: options.persistRun ?? persistRunToDb,
    onFinished: (roomId) => {
      rooms.removeRoom(roomId);
    },
  });

  const matchmaking = new MatchmakingQueue({
    roomStore: options.roomStore ?? prismaRoomStore,
    roomManager: rooms,
    now: options.now ?? Date.now,
    waveConfig: options.waveConfig ?? (waves as WaveConfig[]),
    broadcast: (userId, message) => {
      sessions.send(userId, message);
    },
    onAssigned: (userId, roomId) => {
      const session = sessions.getByUserId(userId);
      if (session) {
        session.roomId = roomId;
      }
    },
    onRunStarted: (roomId, userIds) => {
      for (const userId of userIds) {
        const session = sessions.getByUserId(userId);
        if (session) {
          session.roomId = roomId;
        }
      }
    },
  });

  return { sessions, groups, rooms, matchmaking, players };
}
