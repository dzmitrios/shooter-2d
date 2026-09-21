# shooter-2d

Co-op 2D top-down survival shooter. pnpm monorepo: React client, Node server, PostgreSQL.

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/installation) 12.5.1 (`corepack enable` then `corepack prepare pnpm@12.5.1 --activate`)
- Docker (for PostgreSQL)

## 1. Install dependencies

```bash
pnpm install
```

## 2. Start PostgreSQL

```bash
docker run -d --name shooter-2d-postgres \
  -e POSTGRES_USER=shooter \
  -e POSTGRES_PASSWORD=shooter \
  -e POSTGRES_DB=shooter2d \
  -p 5433:5432 \
  postgres:17
```

Port `5433` matches the sample `DATABASE_URL`. Change both if that port is already in use.

## 3. Environment variables

```bash
cp apps/server/.env.example apps/server/.env
cp apps/server/.env.example packages/db/.env
```

Set a real `JWT_SECRET` in `apps/server/.env`. Prisma CLI reads `DATABASE_URL` from `packages/db/.env`.

## 4. Database schema

```bash
pnpm --filter @shooter/db exec prisma generate
pnpm --filter @shooter/db exec prisma migrate deploy
pnpm --filter @shooter/db build
pnpm --filter @shooter/shared build
```

## 5. Run

From the repo root:

```bash
pnpm --filter @shooter/server dev
pnpm --filter @shooter/client dev
```

- Client: http://localhost:5173
- Server: http://localhost:3000

Auth check:

```bash
curl -sS -X POST http://localhost:3000/auth/guest
```
