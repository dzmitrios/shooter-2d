## Context

The repo is a pnpm workspace: Vite client (`apps/client`), Express + `ws` server (`apps/server`), Prisma in `packages/db`. There is no Dockerfile, Compose file, Terraform, or GitHub Actions workflow. The server listens on `PORT` (default 3000), refuses to start without `JWT_SECRET`, and reads `DATABASE_URL` from the environment. Guest and profile routes are `/auth/*` and `/profile/*`. The WebSocket server is attached to that same HTTP server and accepts `?token=` on the request URL. The client already calls REST with a relative base when `VITE_API_URL` is unset, and `getWsUrl()` uses the page host when the port is not the Vite dev port `5173`.

Rooms and matchmaking live in memory on one process (`SessionRegistry`, `RoomManager`, `MatchmakingQueue`). Persistence of accounts and run results is PostgreSQL. See proposal.md for why the stand exists. Behavior contracts are in `specs/demo-stand/spec.md` and `specs/server-observability/spec.md`.

## Goals / Non-Goals

**Goals:**

- One command path brings the stand up and prints its public IP; another tears the compute down.
- The running stand is a single host on port 80. Local `pnpm dev` stays unchanged.
- Terraform is split so a later change can replace the compute module or point `DATABASE_URL` at RDS without rewriting the app.
- The server emits JSON logs, optional Sentry events, and Prometheus text at `GET /metrics`.

**Non-Goals:**

- A domain, TLS, load balancer, NAT, CloudFront, RDS, ElastiCache, ECS, or EKS.
- More than one game-server process, or moving room state out of memory.
- Running Prometheus or Grafana, or shipping metrics off the box.
- Keeping demo player data after destroy.

## Decisions

### One EC2 instance running Docker Compose

The stand is a single `t4g.small` (Amazon Linux 2023, arm64) in a public subnet in `eu-central-1`. Compose runs three services: `web` (nginx), `server`, and `postgres`. Only host port 80 is published.

ECS would match a later multi-service layout, but a public IP on Fargate still needs a load balancer to be stable and HTTPS-free in a way that is easy to show. An ALB or NAT is the expensive part of a short-lived stand. One instance avoids both. The growth seam is the Terraform module boundary and `DATABASE_URL`, not an empty ECS service.

Alternative considered: ECS on Fargate with a public IP. Rejected for this stand because the load balancer or the lack of a same-origin static host adds cost and moving parts before a second service exists.

### Public subnet, automatic public IP, no SSH

The VPC has public subnets and an internet gateway. The instance gets an auto-assigned public IPv4, not an Elastic IP, so terminating it releases the address and cannot leave an unattached EIP billing. The security group allows inbound TCP 80 from the internet and outbound traffic. Port 22, 3000, and 5432 are not open. An operator debugs through SSM Session Manager; the instance role includes `AmazonSSMManagedInstanceCore` plus ECR pull and read of the stand's SSM parameters.

### nginx is the only public listener

The `web` image is nginx plus the Vite build. `VITE_API_URL` and `VITE_WS_URL` are left unset at build time so the browser uses the page origin. That matters because the public IP is known only after apply.

nginx proxies `/auth/` and `/profile/` to `server:3000`. A request to `/` with an `Upgrade` header is proxied to the same upstream so `ws://<ip>/?token=` reaches the existing WebSocket server. Other `/` requests use `try_files` and fall back to `index.html`. `/metrics` is not proxied and is not a static file, so the public origin does not return the metrics document.

### Postgres beside the server, URL injected

`postgres:17` runs only on the Compose network, with a volume on the instance disk. A Terraform `random_password` and a generated `JWT_SECRET` are stored as SSM SecureString parameters in the stand stack and passed into Compose as `DATABASE_URL` and `JWT_SECRET`. Neither value is baked into an image or committed. The server image entrypoint runs `prisma migrate deploy` against `packages/db`, then `node dist/index.js` without `--env-file`. Destroying the instance deletes the disk, which is the empty-database behavior on the next apply.

Alternative considered: RDS. Rejected because a destroyed instance would still leave storage cost, and demo data does not need to survive.

### Two Terraform roots

`infra/bootstrap` is applied once from a workstation and is not destroyed with the stand. It creates the state bucket (S3 lockfile, Terraform >= 1.10, no DynamoDB), ECR repositories for `server` and `web`, and a GitHub OIDC provider plus a deploy role. Those are the leftovers the spec allows. The role has no hourly charge.

`infra/stand` uses that bucket as its backend. It owns the VPC, security group, instance role, EC2 instance, and the SSM parameters. `terraform destroy` in this root is the off switch. Module directories are `network` and `compute` so a later change can swap `compute` for ECS or add a `database` module without touching the client.

Images are built in GitHub Actions for `linux/arm64` and pushed to ECR. Instance user-data installs Docker, logs into ECR, writes the Compose file from a Terraform template, and starts the stack.

### GitHub Actions

- Pull requests: install, typecheck, and test on Node 20 with a Postgres service. They do not call Terraform.
- `workflow_dispatch` apply: OIDC into the bootstrap role, build and push images, `terraform apply` in `infra/stand`, print `public_ip`.
- `workflow_dispatch` destroy: OIDC, `terraform destroy` in `infra/stand`.

No long-lived AWS keys in the repository. The operator stores the bootstrap role ARN as a GitHub secret.

### Logs, Sentry, metrics

Pino replaces `console.log` / `console.error` on the server, including the Express error handler and the matchmaking tick failure path. Each line is JSON on stdout. Docker's json-file driver keeps them on the instance; they disappear with destroy. No CloudWatch log group, so destroy cannot leave log storage behind.

`@sentry/node` is initialized only when `SENTRY_DSN` is set. The stand does not set it. The Express error handler reports thrown errors when the SDK is active.

`prom-client` serves `GET /metrics` from the Express app. Series:

- `shooter_connected_players` — gauge from the session registry
- `shooter_rooms` — gauge from `RoomManager`
- `shooter_matchmaking_failures_total` — counter incremented where matchmaking already logs a tick failure
- `shooter_tick_duration_seconds` — histogram observed around `GameInstance.tick()`

A unit test can request the Express app directly. nginx never forwards `/metrics`.

## Risks / Trade-offs

- [HTTP on a public IP exposes JWTs and gameplay traffic] → The stand is for a short showing and is destroyed afterward. TLS waits for a domain.
- [Stopping the instance is not destroy] → Stopped instances and their disks still bill, and the public IP changes on the next start. The supported off switch is the destroy workflow.
- [arm64 images build under emulation on GitHub-hosted amd64 runners] → Use `docker buildx` for `linux/arm64`. If a build is too slow to be usable, switch the instance to `t3.small` and build amd64; that does not change the Compose or Terraform shape.
- [One process cannot scale out] → `desired_count` is not a knob on this stand. Adding a second server would split in-memory rooms. A later change has to externalize matchmaking before `compute` runs more than one task.
- [`t4g.small` may be tight once a match is running] → 2 GB is the working assumption. If the first showing OOMs, bump the instance type in the `compute` module only.
- [Forgetting bootstrap vs stand] → Apply and destroy workflows target only `infra/stand`. Bootstrap is documented as a one-time local apply.

## Migration Plan

1. Apply `infra/bootstrap` once locally and put the role ARN in GitHub Actions secrets.
2. Dispatch the apply workflow. It pushes images and creates the stand.
3. Open `http://<public_ip>/`, play, then dispatch destroy.
4. Rollback of a bad stand is the same destroy. There is no data to migrate. Local development does not read these resources.

## Open Questions

None. Instance size can move from `t4g.small` to a larger size inside `compute` if the first showing shows memory pressure; that does not change the specs or the task breakdown.
