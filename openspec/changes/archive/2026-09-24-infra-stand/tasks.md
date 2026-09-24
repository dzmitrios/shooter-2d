## 1. Server observability

- [x] 1.1 Add Pino and write startup, request-failure, and matchmaking-failure logs as single-line JSON on stdout. Verify a unit test asserts a startup line parses as JSON and includes level, time, and the listen port.
- [x] 1.2 Initialize `@sentry/node` only when `SENTRY_DSN` is set, and report errors from the Express error handler when it is. Verify a test that an unset DSN still builds the app and serves a route, and that a thrown handler reports when a DSN is set, without a live Sentry request.
- [x] 1.3 Expose `GET /metrics` with `prom-client` series `shooter_connected_players`, `shooter_rooms`, `shooter_matchmaking_failures_total`, and `shooter_tick_duration_seconds`. Record the histogram around `GameInstance.tick()` and increment the matchmaking counter on tick failure. Verify a test that `GET /metrics` returns Prometheus text containing those names.

## 2. Images and Compose

- [x] 2.1 Add a server image that builds the workspace, includes the Prisma schema and migrations, and starts with `prisma migrate deploy` then `node dist/index.js` using process env rather than `--env-file`. Verify `docker build` of that image completes.
- [x] 2.2 Add a web image that runs `vite build` with `VITE_API_URL` and `VITE_WS_URL` unset and serves it from nginx. Proxy `/auth/` and `/profile/` to the server, proxy `/` only when the `Upgrade` header is set, and do not proxy `/metrics`. Verify `nginx -t` against that config succeeds.
- [x] 2.3 Add a Compose file with `web`, `server`, and `postgres:17` where only host port 80 is published and `DATABASE_URL` plus `JWT_SECRET` come from the environment. Verify `docker compose config` shows no published ports other than 80.

## 3. Terraform

- [x] 3.1 Add `infra/bootstrap` (Terraform >= 1.10) with an S3 state bucket using a lockfile, ECR repositories for `server` and `web`, and a GitHub OIDC deploy role. Verify `terraform validate` in that root succeeds.
- [x] 3.2 Add `infra/stand` module `network`: VPC, public subnet, internet gateway, and no NAT gateway. Verify `terraform validate` in `infra/stand` succeeds.
- [x] 3.3 Add `infra/stand` module `compute`: `t4g.small` with an auto-assigned public IP, a security group open only on TCP 80, an instance role for SSM, ECR pull, and SSM parameter read, user-data that starts Compose from ECR, and a `public_ip` output. Generate `JWT_SECRET` and the database password into SSM SecureString parameters in this root. Verify `terraform validate` still succeeds and the plan references no Elastic IP, load balancer, or NAT gateway.

## 4. GitHub Actions

- [x] 4.1 Add a pull request workflow that installs dependencies, typechecks, and tests on Node 20 with a Postgres service, and does not run Terraform. Verify the workflow trigger is `pull_request` only.
- [x] 4.2 Add a manual apply workflow that assumes the bootstrap role via OIDC, builds and pushes `linux/arm64` images to ECR, applies `infra/stand`, and prints `public_ip`. Verify the workflow trigger is `workflow_dispatch` only.
- [x] 4.3 Add a manual destroy workflow that assumes the same role and runs `terraform destroy` in `infra/stand` only. Verify the workflow does not target `infra/bootstrap`.

## 5. Operator notes

- [x] 5.1 Document the one-time local bootstrap, the GitHub role-ARN secret, and the apply and destroy dispatches in the README. Verify the section names `infra/bootstrap` and `infra/stand` and states that stopping the instance is not the off switch.
