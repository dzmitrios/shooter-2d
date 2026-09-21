import http from 'node:http';
import { createApp } from './rest/app.js';
import { getJwtSecret } from './rest/jwt.js';

export type { ClientMessage, ServerMessage } from '@shooter/shared';

const PORT = Number(process.env['PORT'] ?? 3000);

// Fail fast if JWT_SECRET is unset, rather than 500ing on the first auth request.
getJwtSecret();

const app = createApp();
const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
