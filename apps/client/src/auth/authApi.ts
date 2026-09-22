export interface AuthSession {
  token: string;
  userId: string;
}

export class AuthApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
  }
}

function getApiBase(): string {
  const env = (import.meta as ImportMeta & { env?: { VITE_API_URL?: string } }).env;
  return env?.VITE_API_URL ?? '';
}

async function parseAuthResponse(res: Response): Promise<AuthSession> {
  const body: unknown = await res.json().catch(() => null);
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  if (!res.ok) {
    const message = typeof record.error === 'string' ? record.error : `Auth failed (${res.status})`;
    throw new AuthApiError(res.status, message);
  }
  if (typeof record.token !== 'string' || typeof record.userId !== 'string') {
    throw new AuthApiError(res.status, 'Invalid auth response');
  }
  return { token: record.token, userId: record.userId };
}

export async function loginGuest(): Promise<AuthSession> {
  const res = await fetch(`${getApiBase()}/auth/guest`, { method: 'POST' });
  return parseAuthResponse(res);
}

export async function login(username: string, password: string): Promise<AuthSession> {
  const res = await fetch(`${getApiBase()}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return parseAuthResponse(res);
}

export async function register(username: string, password: string): Promise<AuthSession> {
  const res = await fetch(`${getApiBase()}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return parseAuthResponse(res);
}
