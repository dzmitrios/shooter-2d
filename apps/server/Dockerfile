FROM node:26-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@12.5.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/server apps/server

RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    pnpm --filter @shooter/db db:generate \
 && pnpm --filter @shooter/server... build

FROM node:26-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@12.5.1

COPY --from=build /app /app
RUN chmod +x /app/apps/server/docker-entrypoint.sh

ENTRYPOINT ["/app/apps/server/docker-entrypoint.sh"]
