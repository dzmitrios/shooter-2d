import type { ServerMessage } from '@shooter/shared';
import type { WebSocket } from 'ws';
import { send } from './send.js';

export interface PlayerSession {
  userId: string;
  username: string;
  socket: WebSocket;
  weaponId?: string;
  groupId?: string;
  roomId?: string;
}

export class SessionRegistry {
  private readonly byUserId = new Map<string, PlayerSession>();
  private readonly bySocket = new Map<WebSocket, PlayerSession>();

  add(session: PlayerSession): void {
    this.byUserId.set(session.userId, session);
    this.bySocket.set(session.socket, session);
  }

  getByUserId(userId: string): PlayerSession | undefined {
    return this.byUserId.get(userId);
  }

  getBySocket(socket: WebSocket): PlayerSession | undefined {
    return this.bySocket.get(socket);
  }

  remove(socket: WebSocket): PlayerSession | undefined {
    const session = this.bySocket.get(socket);
    if (!session) {
      return undefined;
    }
    this.bySocket.delete(socket);
    if (this.byUserId.get(session.userId)?.socket === socket) {
      this.byUserId.delete(session.userId);
    }
    return session;
  }

  send(userId: string, message: ServerMessage): void {
    const session = this.byUserId.get(userId);
    if (session) {
      send(session.socket, message);
    }
  }
}
