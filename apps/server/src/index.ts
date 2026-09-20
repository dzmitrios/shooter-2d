import http from 'node:http';

const PORT = process.env['PORT'] ?? 3000;

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('shooter-2d server\n');
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
