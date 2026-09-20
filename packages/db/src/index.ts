import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

export { db };
export { PrismaClient } from '@prisma/client';
export type * from '@prisma/client';
