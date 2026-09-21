import jwt from 'jsonwebtoken';

export interface AuthTokenPayload {
  userId: string;
}

export function getJwtSecret(): string {
  const secret = process.env['JWT_SECRET'];
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return secret;
}

export function signToken(userId: string): string {
  return jwt.sign({ userId }, getJwtSecret(), { expiresIn: '7d' });
}

export function verifyToken(token: string): AuthTokenPayload {
  const decoded = jwt.verify(token, getJwtSecret());
  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    typeof decoded.userId !== 'string'
  ) {
    throw new Error('Invalid token payload');
  }
  return { userId: decoded.userId };
}
