## Why

The game runs only on a local machine, so there is nothing to show someone else and nothing that can later grow into a hosted environment. A demo stand on AWS should come up for a showing, then shut down to nearly zero cost, while the Terraform layout and server instrumentation stay ready for more services later.

## What Changes

- Add a manually operated AWS demo stand: one EC2 instance reached by public IP over `http` and `ws`, with no domain, load balancer, NAT, or CloudFront.
- Run nginx, the game server, and PostgreSQL together on that instance via Docker Compose. nginx serves the built client and proxies REST and WebSocket on the same origin.
- Treat demo database data as disposable. Apply Prisma migrations when the stand starts. Pass `DATABASE_URL` in from outside the server image so a later stand can point at RDS without changing application code.
- Keep a single game-server process. Room and matchmaking state stay in that process's memory.
- Leave only the Terraform state bucket, the ECR repositories, and the GitHub OIDC deploy role after destroy. The role has no hourly charge. Release the instance and its public IP with the stand.
- Add structured server logs, an optional Sentry hook, and a Prometheus metrics endpoint. Do not run Prometheus or Grafana on the stand.
- Add GitHub Actions: pull requests build and test; apply and destroy run only from manual dispatches, authenticating to AWS with OIDC.

## Capabilities

### New Capabilities

- `demo-stand`: Lifecycle, reachability, and leftover cost of the disposable AWS demo environment.
- `server-observability`: Structured logs, optional error reporting, and a metrics endpoint on the game server.

### Modified Capabilities

_None. Persistence still uses PostgreSQL, and the WebSocket protocol is unchanged. Demo data being wiped on destroy is a property of this environment, not a change to the persistence model._

## Impact

- New infrastructure and delivery files: Terraform, Docker Compose, nginx config, Dockerfiles, GitHub Actions workflows.
- Server dependencies and startup: Pino, optional Sentry, `prom-client`, migration command before listen.
- Client production build is served by nginx. Dev proxy and local Postgres stay as they are.
- AWS account resources created only while the stand is applied: VPC with public subnets, one EC2 instance, security group, instance profile. Durable leftovers: remote state bucket, ECR, and the OIDC deploy role.
