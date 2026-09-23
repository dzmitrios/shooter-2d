## Context

This is a greenfield project — no existing codebase, no live users, no legacy constraints. The game design is fully captured in `spec.md` (root of the repo). See `proposal.md` for the motivation behind building the MVP now.

The target is a monorepo where a Node.js WebSocket/REST game server and a React + PixiJS browser client share TypeScript types via a `packages/shared` workspace. All game state for active rooms lives in server memory; only persistence-tier data (accounts, progression, run history) goes to PostgreSQL.

## Goals / Non-Goals

**Goals:**
- Deliver a fully playable co-op session: auth → hub (weapon select + optional group) → matchmaking queue → arena → results → hub loop.
- Keep the server single-process and single-machine for MVP (no Redis, no horizontal sharding).
- Ship JSON-over-WebSocket snapshots at ~20 Hz; binary protocol is a future optimisation.
- Use Prisma as the sole ORM to make schema changes safe and reviewable.
- Structure the codebase so that future sharding, binary protocol, pathfinding, and boss systems can be bolted on without architectural rewrites.

**Non-Goals:**
- Horizontal scaling / multi-process game server (deferred).
- Full A* pathfinding for monsters (seek/flee only).
- Binary snapshot protocol (MessagePack, etc.).
- Calibrated MMR seasons, rank decay, or leaderboards (rank exists for matchmaking only).
- Voice/text chat, cosmetics, mobile touch input.
- Boss fights, special events.

## Decisions

### D1: pnpm workspaces monorepo
**Decision**: `pnpm` workspaces with four packages: `apps/client`, `apps/server`, `packages/shared`, `packages/db`.  
**Rationale**: Co-locates client and server in one repo, enabling shared TypeScript types. `pnpm` is faster than `npm` workspaces and lighter than Turborepo for MVP scale. Turborepo can be layered on later for build caching.  
**Alternative considered**: Separate repos — rejected because it duplicates protocol type definitions and complicates atomic cross-package changes.

### D2: `packages/shared` for protocol types
**Decision**: All WebSocket message types (Client→Server and Server→Client), entity interfaces (`PlayerState`, `MonsterState`, etc.), and game constants live in `packages/shared` and are imported by both `apps/client` and `apps/server`.  
**Rationale**: Eliminates drift between client and server protocol definitions; a compile error surfaces immediately when either side breaks the contract.  
**Alternative considered**: Copy-paste types into each app — rejected as the main source of subtle protocol bugs.

### D3: `packages/db` for Prisma schema and generated client
**Decision**: `packages/db` owns `prisma/schema.prisma` and re-exports the `@prisma/client`. Only `apps/server` depends on this package.  
**Rationale**: Keeps DB concerns out of the client bundle; migrations and schema evolution are isolated.

### D4: Express for the REST API
**Decision**: Use Express as the HTTP framework for auth and profile endpoints.  
**Rationale**: Ubiquitous ecosystem, minimal API surface, and straightforward TypeScript support via `@types/express`. Express uses Node's native `http.Server` directly, which makes attaching the `ws` WebSocket server seamless (no plugin layer required). Middleware for JWT validation (`express-jwt` or a simple custom middleware with `jsonwebtoken`) is well-understood and easy to test.  
**Alternative considered**: Fastify — faster JSON serialisation and built-in schema validation, but adds a plugin system and a non-standard request lifecycle that increases onboarding friction without meaningful benefit at MVP scale.

### D5: `ws` library for WebSocket
**Decision**: Use the `ws` npm package for the WebSocket server.  
**Rationale**: Minimal, well-maintained, attaches directly to Node's `http.Server` (the same server Express uses), requiring zero extra configuration. Avoids the complexity of Socket.IO (custom transport, room abstractions).  
**Alternative considered**: Socket.IO — rejected because its abstraction layer conflicts with the custom room model and adds unnecessary weight.

### D6: `GameInstance` per room with `setInterval` sim loop
**Decision**: Each active room gets one `GameInstance` object that owns a `setInterval` at ~20 Hz. All game state for that room lives in the instance. On run end the interval is cleared and instance state is discarded.  
**Rationale**: Simple, predictable, no external scheduler needed. Works for MVP single-process constraint.  
**Alternative considered**: A single global tick loop iterating over all rooms — adds coordination complexity and makes per-room pausing harder.

### D7: `MatchmakingQueue` + `RoomManager` singletons
**Decision**: Two cooperating singletons — `MatchmakingQueue` holds players/groups awaiting assignment and runs the rank-proximity algorithm; `RoomManager` maps `roomId → GameInstance` and routes in-run WebSocket messages. Groups are tracked in memory in a `GroupRegistry` (groupId → member sockets + leader).  
**Rationale**: Separates matchmaking concerns (rank sorting, timer, late-join window) from runtime concerns (simulation, snapshot dispatch). Each can be replaced independently — e.g., `MatchmakingQueue` can later delegate to a Redis-backed service without touching `RoomManager`.

### D8: Client architecture — React shell + PixiJS canvas
**Decision**: React owns menus, HUD, hub, and overlay UI. One React component mounts a PixiJS `Application`; the PixiJS ticker drives the canvas directly without going through React state.  
**Rationale**: React re-renders on every game tick would tank performance. PixiJS owns the hot rendering path; React owns UI overlays that change infrequently.  
**Alternative considered**: Phaser — more batteries-included but couples the renderer to a game framework with opinions that conflict with React; PixiJS is a pure renderer.

### D9: Zustand for client state
**Decision**: Use Zustand for UI state (auth session, hub data, lobby state). Game entity state (positions, HP) is held in the PixiJS scene graph and a separate in-memory game store, never in Zustand.  
**Rationale**: Zustand is lightweight, TypeScript-friendly, and does not trigger React re-renders unless components subscribe. The game store is updated directly by the WebSocket message handler; React only subscribes to lobby/HUD state that changes at human speed.

### D10: Client-side prediction with `seq` reconciliation
**Decision**: `input:move` messages include a monotonically incrementing `seq`. Snapshots echo the last processed `seq` per player. The client keeps a ring buffer of unacknowledged inputs and replays them on top of the server-confirmed position when a snapshot arrives.  
**Rationale**: Standard approach (Quake/Valve model). Eliminates input latency for the local player while keeping the server authoritative.  
**Alternative considered**: No prediction — client always shows server state; rejected because even 50–100 ms RTT causes noticeable input lag in a fast-paced shooter.

### D11: JWT for auth; `bcrypt` for password hashing
**Decision**: `jsonwebtoken` for JWT signing/verification; `bcrypt` for password storage.  
**Rationale**: Industry standard for stateless auth in REST + WebSocket scenarios. Tokens include `userId` and expiry. WebSocket auth: token passed as query parameter or first message (decided: Authorization header on upgrade where browsers allow, else first message).  
**Alternative considered**: Sessions with Redis — adds infrastructure dependency; JWTs are stateless and work within single-process MVP.

### D12: Static JSON configs for weapons, upgrades, and waves
**Decision**: `apps/server/src/config/weapons.json`, `upgrades.json`, and `waves.json` hold all balance data. The server reads them at startup. Not stored in DB.  
**Rationale**: Balance tuning is a frequent operation; hot-reloading a JSON file is faster and safer than a DB migration. No relational lookups needed — always read-all.  
**Alternative considered**: DB table — adds migration overhead for every balance change.

### D14: Matchmaking algorithm — rank proximity with group support
**Decision**: `MatchmakingQueue` maintains a sorted list of pending slots (solo players and groups) ordered by rank. Every 500 ms it greedily fills WAITING rooms from the front of the sorted list. A room auto-starts at 10 players or after 10 s. Groups enter the queue as a unit; their average rank is the sort key. In-memory only — no DB writes until the run starts.  
**Rationale**: Simple greedy sort is good enough for MVP traffic (few concurrent players). No need for Elo deltas, win-rate adjustments, or timeout rank relaxation at this scale.  
**Alternative considered**: First-come-first-served with no rank consideration — simpler, but produces highly unbalanced rooms as the player base grows. Rank-sorted queue adds one sort step with negligible CPU cost.  
**Rank update after run**: At run end the server adjusts each player's rank by a fixed delta (configurable: +/− N points) based on waves survived relative to other players in the room. Formula goes in config; no complex Elo for MVP.

### D13: Seek/flee monster AI without pathfinding
**Decision**: Monsters move directly toward/away from the nearest living player. No obstacle avoidance beyond arena walls.  
**Rationale**: Full A* pathfinding requires a nav mesh, which requires art-defined walkable areas. For MVP with placeholder geometry, seek/flee is sufficient and keeps server CPU predictable.

## Risks / Trade-offs

- **Single-process bottleneck** → All rooms in one Node.js process; a crash takes all rooms down; a runaway room can starve others. Mitigation: per-room `GameInstance` isolation, rate limits on inputs, CPU budget monitoring. Horizontal sharding is a documented next step.
- **`setInterval` drift** → Node.js `setInterval` is not real-time and can drift under load, causing variable tick rates. Mitigation: record actual elapsed time per tick and use delta-time physics; log ticks that exceed 2× target interval.
- **JSON snapshot size** → At 20 Hz with 10 players + monsters + projectiles, JSON payloads can be several KB/s per client. Mitigation: send only changed entities (delta snapshots) as an optimisation; accept full snapshots for MVP. MessagePack migration is documented.
- **Client prediction divergence** → Aggressive prediction can cause visible snapping on correction. Mitigation: use smooth interpolation of the positional correction over several frames rather than instant snap.
- **No anti-cheat** → Server-authoritative, but no anomaly detection for speed hacks, teleporting, etc. Rate limiting on `input:*` is the only defence at MVP. Full anti-cheat is out of scope.
- **Guest accounts are anonymous** → Guests cannot recover their account. Mitigation: display in-app prompt encouraging registration; no technical blocker to add migration later.

## Migration Plan

This is a greenfield project; there is no existing deployment to migrate.

**Initial deployment steps:**
1. Provision a PostgreSQL instance.
2. Set `DATABASE_URL` in environment.
3. Run `pnpm --filter @shooter/db exec prisma migrate deploy` to apply the initial schema.
4. Build and start the server (`apps/server`).
5. Build and deploy the client (`apps/client`) to a static CDN.

**Rollback**: Because there are no existing users, rollback is drop-and-recreate the database. A documented migration strategy (with down migrations) will be required before the first public release.

## Open Questions

- **Default weapon IDs**: Exact IDs and stats for the two default-unlocked weapons are to be decided during content pass; the code uses the config lookup, so no structural change is needed.
- **Level-up XP thresholds**: Exact per-level XP curve goes in `config/upgrades.json`; tunable post-MVP without code changes.
- **Drop probabilities and buff durations**: Balance parameters in `config/waves.json` and `config/weapons.json`; tunable post-MVP.
