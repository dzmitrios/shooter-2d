import type { ErrorCode, ServerMessage } from '@shooter/shared';
import type { WebSocket } from 'ws';
import { WebSocket as Ws } from 'ws';

export function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== Ws.OPEN) {
    return;
  }
  socket.send(JSON.stringify(message));
}

export function sendError(socket: WebSocket, code: ErrorCode, message?: string): void {
  send(socket, { type: 'error', code, message });
}
