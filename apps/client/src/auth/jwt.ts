export interface AuthJwtPayload {
  userId: string;
  exp?: number;
}

function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  return atob(padded + '='.repeat(padLength));
}

export function decodeJwtPayload(token: string): AuthJwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(parts[1]));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { userId?: unknown }).userId !== 'string'
    ) {
      return null;
    }
    const payload = parsed as { userId: string; exp?: unknown };
    const result: AuthJwtPayload = { userId: payload.userId };
    if (typeof payload.exp === 'number' && Number.isFinite(payload.exp)) {
      result.exp = payload.exp;
    }
    return result;
  } catch {
    return null;
  }
}

export function isJwtExpired(payload: AuthJwtPayload, nowMs = Date.now()): boolean {
  if (payload.exp === undefined) {
    return false;
  }
  return payload.exp * 1000 <= nowMs;
}

export function readValidJwt(token: string | null | undefined, nowMs = Date.now()): AuthJwtPayload | null {
  if (!token) {
    return null;
  }
  const payload = decodeJwtPayload(token);
  if (!payload || isJwtExpired(payload, nowMs)) {
    return null;
  }
  return payload;
}
