#!/bin/sh
set -eu
cd /app/packages/db
pnpm exec prisma migrate deploy
exec node /app/apps/server/dist/index.js
