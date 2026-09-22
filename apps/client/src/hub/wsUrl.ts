export function getWsUrl(): string {
  const env = (import.meta as ImportMeta & { env?: { VITE_WS_URL?: string; VITE_API_URL?: string } })
    .env;
  if (env?.VITE_WS_URL) {
    return env.VITE_WS_URL;
  }
  if (env?.VITE_API_URL) {
    return env.VITE_API_URL.replace(/^http/i, 'ws');
  }
  if (typeof location !== 'undefined' && location.hostname) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const port = location.port === '5173' ? '3000' : location.port;
    return `${protocol}//${location.hostname}${port ? `:${port}` : ''}`;
  }
  return 'ws://localhost:3000';
}
