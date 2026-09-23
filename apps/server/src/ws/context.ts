import type { WaveConfig } from '@shooter/shared';
import { gameConfig, type GameConfig } from '../config/index.js';
import waves from '../config/waves.json' with { type: 'json' };
import { persistRunToDb, type PersistRun } from '../game/runPersistence.js';
import { GroupRegistry } from './groupRegistry.js';
import { InputRateLimiter } from './inputRateLimiter.js';
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
  inputRateLimiter: InputRateLimiter;
}

export interface GameContextOptions {
  players?: PlayerDirectory;
  roomStore?: RoomStore;
  now?: () => number;
  waveConfig?: WaveConfig[];
  persistRun?: PersistRun;
  inputRateLimiter?: InputRateLimiter;
  config?: GameConfig;
}

export function createGameContext(options: GameContextOptions = {}): GameContext {
  // Info about player sessions (user, weapon, room, group, socket)
  const sessions = new SessionRegistry();
  // Info about groups (leader, members, groupCode)
  const groups = new GroupRegistry();
  const players = options.players ?? prismaPlayerDirectory;
  const waveConfig = options.waveConfig ?? (waves as WaveConfig[]);

  // Info about rooms (players, startedAt)
  const rooms = new RoomManager({
    autoStart: true,
    waves: waveConfig,
    config: options.config,
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
    waveConfig,
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

  const inputRateLimiter =
    options.inputRateLimiter ?? new InputRateLimiter(gameConfig.inputRateLimit);

  return { sessions, groups, rooms, matchmaking, players, inputRateLimiter };
}
