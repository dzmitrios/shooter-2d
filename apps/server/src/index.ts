import http from 'node:http';
import './config/index.js';
import { logListening } from './observability/logger.js';
import { setMetricsSources } from './observability/metrics.js';
import { initSentry } from './observability/sentry.js';
import { createApp } from './rest/app.js';
import { getJwtSecret } from './rest/jwt.js';
import { attachWebSocket } from './ws/gateway.js';
import { createGameContext } from './ws/context.js';

const PORT = Number(process.env['PORT'] ?? 3000);

// Fail fast if JWT_SECRET is unset, rather than 500ing on the first auth request.
getJwtSecret();
initSentry();

const app = createApp();
const server = http.createServer(app);
const game = createGameContext();

setMetricsSources({
  connectedPlayers: () => game.sessions.connectedCount(),
  rooms: () => game.rooms.roomCount(),
});

attachWebSocket(server, game);
game.matchmaking.start();

server.listen(PORT, () => {
  logListening(PORT);
});
