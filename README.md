# shooter-2d

Co-op 2D top-down survival shooter. pnpm monorepo: React client, Node server, PostgreSQL.

## Prerequisites

- Node.js 26
- [pnpm](https://pnpm.io/installation) 12.5.1 (`npm install -g pnpm@12.5.1`)
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

## Demo stand

`infra/bootstrap` is applied once from a workstation and is kept. `infra/stand` is the running game: one instance, its network, and its secrets. Stopping the instance is not the off switch. A stopped instance still bills for its disk, and the public IP changes the next time it starts. Use the destroy dispatch below.

### One-time bootstrap

With AWS credentials that can create IAM, S3, and ECR in `eu-central-1`:

```bash
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap apply
terraform -chdir=infra/bootstrap output -raw deploy_role_arn
```

Store that role ARN as the GitHub Actions secret `AWS_ROLE_ARN`. Bootstrap state stays on this workstation (`infra/bootstrap/terraform.tfstate`).

### Apply and destroy

Dispatch **Apply stand**. It assumes `AWS_ROLE_ARN` with OIDC, pushes `linux/arm64` images, applies `infra/stand`, and prints `public_ip`. Open `http://<public_ip>/`.

Dispatch **Destroy stand** when the showing is over. It assumes the same role and runs `terraform destroy` in `infra/stand` only. The state bucket, ECR repositories, and deploy role from `infra/bootstrap` remain.
