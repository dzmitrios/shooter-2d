import http from 'node:http';
import './config/index.js';
import { createApp } from './rest/app.js';
import { getJwtSecret } from './rest/jwt.js';
import { attachWebSocket } from './ws/gateway.js';
import { createGameContext } from './ws/context.js';

// TODO: remove this
export type { ClientMessage, ServerMessage } from '@shooter/shared';

const PORT = Number(process.env['PORT'] ?? 3000);

// Fail fast if JWT_SECRET is unset, rather than 500ing on the first auth request.
getJwtSecret();

const app = createApp();
const server = http.createServer(app);
const game = createGameContext();

attachWebSocket(server, game);
game.matchmaking.start();

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
