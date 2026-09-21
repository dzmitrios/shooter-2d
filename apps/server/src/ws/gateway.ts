import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { verifyToken } from '../rest/jwt.js';
import type { GameContext } from './context.js';
import { handleDisconnect, handleMessage } from './router.js';
import type { PlayerSession } from './sessionRegistry.js';

interface AuthedRequest extends IncomingMessage {
  userId?: string;
}

export function attachWebSocket(server: HttpServer, ctx: GameContext): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    verifyClient: (info, callback) => {
      const token = extractToken(info.req);
      if (!token) {
        callback(false, 401, 'Unauthorized');
        return;
      }
      try {
        const { userId } = verifyToken(token);
        (info.req as AuthedRequest).userId = userId;
        callback(true);
      } catch {
        callback(false, 401, 'Unauthorized');
      }
    },
  });

  wss.on('connection', (socket, req) => {
    void onConnection(ctx, socket, req as AuthedRequest);
  });

  return wss;
}

export function extractToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice('Bearer '.length);
  }

  const host = req.headers.host ?? 'localhost';
  try {
    const url = new URL(req.url ?? '/', `http://${host}`);
    return url.searchParams.get('token') ?? undefined;
  } catch {
    return undefined;
  }
}

async function onConnection(
  ctx: GameContext,
  socket: WebSocket,
  req: AuthedRequest,
): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    socket.close();
    return;
  }

  const existing = ctx.sessions.getByUserId(userId);
  if (existing) {
    ctx.sessions.remove(existing.socket);
    handleDisconnect(ctx, existing);
    existing.socket.close();
  }

  const username = await ctx.players.getUsername(userId);
  const session: PlayerSession = { userId, username, socket };
  ctx.sessions.add(session);

  socket.on('message', (data) => {
    void handleMessage(ctx, session, data.toString());
  });

  socket.on('close', () => {
    const current = ctx.sessions.remove(socket);
    if (current) {
      handleDisconnect(ctx, current);
    }
  });
}
