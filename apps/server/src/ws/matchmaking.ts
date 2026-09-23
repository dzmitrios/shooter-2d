import { randomInt, randomUUID } from 'node:crypto';
import type { ServerMessage, WaveConfig } from '@shooter/shared';
import type { RoomPlayer } from '../game/gameInstance.js';
import { logger } from '../observability/logger.js';
import { matchmakingFailures } from '../observability/metrics.js';
import type { RoomManager } from './roomManager.js';
import type { RoomStore } from './roomStore.js';

export const MAX_ROOM_PLAYERS = 10;
export const AUTO_START_MS = 10_000;
export const MATCH_TICK_MS = 500;

export interface QueueSlotPlayer extends RoomPlayer {}

export interface QueueSlot {
  id: string;
  players: QueueSlotPlayer[];
  rank: number;
  groupId?: string;
}

export interface WaitingRoom {
  roomId: string;
  players: QueueSlotPlayer[];
  firstAssignedAt: number;
}

export interface MatchmakingDeps {
  roomStore: RoomStore;
  roomManager: RoomManager;
  now: () => number;
  waveConfig: WaveConfig[];
  broadcast: (userId: string, message: ServerMessage) => void;
  onAssigned?: (userId: string, roomId: string) => void;
  onRunStarted?: (roomId: string, userIds: string[]) => void;
}

export class MatchmakingQueue {
  private pending: QueueSlot[] = [];
  private waiting: WaitingRoom[] = [];
  private readonly starting = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: MatchmakingDeps) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick().catch((err: unknown) => {
        matchmakingFailures.inc();
        logger.error({ err }, 'matchmaking tick failed');
      });
    }, MATCH_TICK_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  enqueue(slot: QueueSlot): void {
    for (const player of slot.players) {
      this.leave(player.userId);
    }
    this.pending.push(slot);
  }

  leave(userId: string): QueueSlot | undefined {
    const pendingIndex = this.pending.findIndex((slot) =>
      slot.players.some((player) => player.userId === userId),
    );
    if (pendingIndex >= 0) {
      const [slot] = this.pending.splice(pendingIndex, 1);
      return slot;
    }

    for (const room of this.waiting) {
      if (this.starting.has(room.roomId)) {
        continue;
      }
      const playerIndex = room.players.findIndex((player) => player.userId === userId);
      if (playerIndex < 0) {
        continue;
      }
      const [player] = room.players.splice(playerIndex, 1);
      if (room.players.length === 0) {
        this.waiting = this.waiting.filter((candidate) => candidate.roomId !== room.roomId);
      }
      return { id: randomUUID(), players: [player], rank: player.rank };
    }

    return undefined;
  }

  hasPlayer(userId: string): boolean {
    if (this.pending.some((slot) => slot.players.some((player) => player.userId === userId))) {
      return true;
    }
    return this.waiting.some((room) => room.players.some((player) => player.userId === userId));
  }

  getPending(): QueueSlot[] {
    return this.pending;
  }

  getWaitingRooms(): WaitingRoom[] {
    return this.waiting;
  }

  async tick(): Promise<void> {
    await this.assignPending();
    await this.startReadyRooms();
  }

  private async assignPending(): Promise<void> {
    const slots = [...this.pending].sort((a, b) => a.rank - b.rank);
    const unmatched: QueueSlot[] = [];

    for (const slot of slots) {
      const room = this.findBestWaitingRoom(slot);
      if (!room) {
        unmatched.push(slot);
        continue;
      }
      this.addSlotToRoom(room, slot);
      this.pending = this.pending.filter((candidate) => candidate.id !== slot.id);
      if (room.players.length >= MAX_ROOM_PLAYERS) {
        await this.startRoom(room);
      }
    }

    let index = 0;
    while (index < unmatched.length) {
      const first = unmatched[index];
      const room = await this.createWaitingRoom();
      this.addSlotToRoom(room, first);
      this.pending = this.pending.filter((candidate) => candidate.id !== first.id);
      index += 1;

      while (index < unmatched.length) {
        const next = unmatched[index];
        if (room.players.length + next.players.length > MAX_ROOM_PLAYERS) {
          break;
        }
        this.addSlotToRoom(room, next);
        this.pending = this.pending.filter((candidate) => candidate.id !== next.id);
        index += 1;
      }

      if (room.players.length >= MAX_ROOM_PLAYERS) {
        await this.startRoom(room);
      }
    }
  }

  private async startReadyRooms(): Promise<void> {
    const now = this.deps.now();
    const due = this.waiting.filter(
      (room) =>
        !this.starting.has(room.roomId) &&
        room.players.length > 0 &&
        now - room.firstAssignedAt >= AUTO_START_MS,
    );
    for (const room of due) {
      await this.startRoom(room);
    }
  }

  private findBestWaitingRoom(slot: QueueSlot): WaitingRoom | undefined {
    const now = this.deps.now();
    const candidates = this.waiting.filter(
      (room) =>
        !this.starting.has(room.roomId) &&
        now - room.firstAssignedAt < AUTO_START_MS &&
        room.players.length + slot.players.length <= MAX_ROOM_PLAYERS,
    );
    if (candidates.length === 0) {
      return undefined;
    }

    return candidates.reduce((best, room) => {
      const bestDelta = Math.abs(averageRank(best.players) - slot.rank);
      const roomDelta = Math.abs(averageRank(room.players) - slot.rank);
      return roomDelta < bestDelta ? room : best;
    });
  }

  private addSlotToRoom(room: WaitingRoom, slot: QueueSlot): void {
    const wasEmpty = room.players.length === 0;
    room.players.push(...slot.players);
    if (wasEmpty) {
      room.firstAssignedAt = this.deps.now();
    }
    for (const player of slot.players) {
      this.deps.onAssigned?.(player.userId, room.roomId);
    }
  }

  private async createWaitingRoom(): Promise<WaitingRoom> {
    const row = await this.deps.roomStore.createWaiting(MAX_ROOM_PLAYERS);
    const room: WaitingRoom = {
      roomId: row.id,
      players: [],
      firstAssignedAt: this.deps.now(),
    };
    this.waiting.push(room);
    return room;
  }

  private async startRoom(room: WaitingRoom): Promise<void> {
    if (this.starting.has(room.roomId) || room.players.length === 0) {
      return;
    }
    this.starting.add(room.roomId);
    this.waiting = this.waiting.filter((candidate) => candidate.roomId !== room.roomId);

    const seed = randomInt(1, 2_147_483_647);
    const startedAt = new Date(this.deps.now());
    await this.deps.roomStore.markInRun(room.roomId, startedAt);
    this.deps.roomManager.createRoom(room.roomId, room.players, seed);

    const message: ServerMessage = {
      type: 'run:started',
      seed,
      waveConfig: this.deps.waveConfig,
    };
    const userIds = room.players.map((player) => player.userId);
    for (const userId of userIds) {
      this.deps.broadcast(userId, message);
    }
    this.deps.onRunStarted?.(room.roomId, userIds);
  }
}

function averageRank(players: QueueSlotPlayer[]): number {
  if (players.length === 0) {
    return 0;
  }
  return players.reduce((sum, player) => sum + player.rank, 0) / players.length;
}

export function averageSlotRank(players: QueueSlotPlayer[]): number {
  return averageRank(players);
}
