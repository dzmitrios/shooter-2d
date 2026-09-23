## Why

This project has no codebase yet. The game design is fully specified in `spec.md` — a co-op online 2D top-down survival shooter with meta-progression. Building the MVP establishes the entire playable product: from authentication through hub, rank-based auto-matchmaking, arena gameplay, and post-run meta-progression. Without the MVP there is nothing to ship or iterate on.

## What Changes

- Stand up a `pnpm` monorepo with three workspaces: `apps/client`, `apps/server`, `packages/shared`, `packages/db`.
- Implement guest and credential-based authentication with JWT (REST API).
- Implement the Hub screen: player profile, rank display, meta-currency, permanent-upgrade shop, weapon selection, friend/group formation, and queue entry.
- Implement rank-based auto-matchmaking: players select weapon in hub, optionally form a group with friends (up to 10), join the queue, and auto-start when 10 players fill or 10 seconds elapse.
- Implement the server-authoritative game arena: player movement/aiming/shooting, 20 Hz simulation tick.
- Implement three monster archetypes (melee, ranged, swarm) with simple seek/flee AI and a wave spawner with increasing difficulty.
- Implement in-run player progression: XP orb collection → level-up → choice of 1-of-3 stat upgrades (movement speed / reload speed / damage).
- Implement drops: XP orbs and medkits from monsters; XP orbs from player deaths; infinite ammo (no ammo mechanic); no map crates.
- Implement spectator mode on player death; run ends when all players are dead.
- Implement post-run results screen and meta-point accrual.
- Implement meta-progression: spend meta-points on permanent stat upgrades and weapon unlocks in the Hub.
- Implement real-time networking: WebSocket protocol with JSON snapshots, client-side prediction + reconciliation for local player, interpolation for remote entities.
- Implement persistence layer: PostgreSQL via Prisma (users, profiles, weapon unlocks, meta-upgrades, run results).

## Capabilities

### New Capabilities

- `auth`: Guest login, register, credential login; JWT issuance and validation; WebSocket authentication via JWT header.
- `hub`: Hub UI (profile, rank, meta-currency), permanent-upgrade shop, weapon-unlock shop, weapon selection before queuing, friend/group formation (create group with shareable code, join group by code), and Start (queue) button.
- `rooms`: Rank-based auto-matchmaking queue; group queuing with average-rank matching; auto-start trigger (10 players OR 10 s); late-join window (< 10 s); no explicit host; room status WAITING → IN_RUN → FINISHED.
- `game-arena`: Core arena gameplay — server-authoritative simulation loop (20 Hz), player movement, mouse-aim, shooting, hit detection, damage application, death detection, spectator transition, run-end trigger.
- `monsters`: Three monster archetypes (melee, ranged, swarm) with seek/flee AI; wave spawner with time-based difficulty scaling; monster death and XP award.
- `player-run-progression`: In-run XP collected from XP-orb drops (not auto-awarded); level-up threshold detection; fixed upgrade choices (movement speed / reload speed / damage); progression resets at run end.
- `drops`: XP orbs always dropped by monsters and players on death; medkits dropped probabilistically by monsters only; no ammo drops (ammo is infinite); no map crates; server-side pickup collision; pickup despawn timeout.
- `meta-progression`: Meta-point calculation from run results; accrual to PlayerProfile; weapon unlock purchase via REST. No permanent stat upgrades.
- `network-protocol`: WebSocket message schema (Client→Server and Server→Client); queue and group management messages; snapshot format and 10–20 Hz dispatch; client-side prediction + server reconciliation for local player; entity interpolation for remote players, monsters, and projectiles.
- `persistence`: Prisma schema (User, PlayerProfile with rank, WeaponUnlock, Room, RunResult with rankBefore/rankAfter); migration baseline; static config files for weapons and waves.

### Modified Capabilities

_None — this is the initial implementation; no existing spec-level behavior is being changed._

## Impact

- **New monorepo structure**: `apps/client`, `apps/server`, `packages/shared`, `packages/db` created from scratch.
- **Client**: React + TypeScript shell (Vite); PixiJS canvas rendered inside a React component; Zustand for UI state; WebSocket client with prediction/reconciliation.
- **Server**: Node.js + TypeScript; Express REST API; `ws` WebSocket server; `GameInstance` per room with `setInterval`-driven sim loop; all rooms held in memory (no horizontal sharding).
- **Database**: PostgreSQL + Prisma; first migration sets up all tables.
- **Shared package**: Protocol message types, constants, and game-entity interfaces shared between client and server.
- **External dependencies**: `pixi.js`, `react`, `zustand`, `ws`, `express`, `prisma`, `@prisma/client`, `jsonwebtoken`, `bcrypt`, `pnpm` workspaces.
