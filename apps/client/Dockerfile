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
COPY apps/client apps/client

RUN pnpm --filter @shooter/client... build

FROM nginx:1.27-alpine

COPY apps/client/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/apps/client/dist /usr/share/nginx/html
