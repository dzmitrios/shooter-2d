import { db } from '@shooter/db';
import { randomUUID } from 'node:crypto';

export interface StoredRoom {
  id: string;
  status: 'WAITING' | 'IN_RUN' | 'FINISHED';
  startedAt: Date | null;
  maxPlayers: number;
}

export interface RoomStore {
  createWaiting(maxPlayers: number): Promise<{ id: string }>;
  markInRun(roomId: string, startedAt: Date): Promise<void>;
}

export class MemoryRoomStore implements RoomStore {
  readonly rooms = new Map<string, StoredRoom>();

  async createWaiting(maxPlayers: number): Promise<{ id: string }> {
    const id = randomUUID();
    this.rooms.set(id, { id, status: 'WAITING', startedAt: null, maxPlayers });
    return { id };
  }

  async markInRun(roomId: string, startedAt: Date): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }
    room.status = 'IN_RUN';
    room.startedAt = startedAt;
  }
}

export const prismaRoomStore: RoomStore = {
  async createWaiting(maxPlayers: number) {
    const room = await db.room.create({
      data: { maxPlayers, status: 'WAITING' },
    });
    return { id: room.id };
  },

  async markInRun(roomId: string, startedAt: Date) {
    await db.room.update({
      where: { id: roomId },
      data: { status: 'IN_RUN', startedAt },
    });
  },
};
