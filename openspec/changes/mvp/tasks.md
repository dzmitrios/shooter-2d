## 1. Monorepo Scaffolding

- [x] 1.1 Initialise pnpm workspace with `pnpm-workspace.yaml` listing `apps/*` and `packages/*`; verify `pnpm install` completes with no errors.
- [x] 1.2 Create `packages/shared` with `package.json` (`@shooter/shared`), `tsconfig.json`, and `src/index.ts`; verify it can be imported by apps via workspace protocol.
- [x] 1.3 Create `packages/db` with `package.json` (`@shooter/db`), Prisma dependency, and placeholder `prisma/schema.prisma`; verify `prisma generate` runs without error.
- [x] 1.4 Create `apps/server` with `package.json` (`@shooter/server`), TypeScript config, and `src/index.ts` entry point; verify `pnpm --filter @shooter/server build` succeeds.
- [x] 1.5 Create `apps/client` with Vite + React + TypeScript template; verify `pnpm --filter @shooter/client dev` serves the default Vite page.
- [x] 1.6 Add root `tsconfig.base.json` shared by all packages; verify all packages extend it and `tsc --noEmit` passes across the monorepo.



## 2. Database Schema and Static Config

- [ ] 2.1 Write the Prisma schema in `packages/db/prisma/schema.prisma` with models: User, PlayerProfile (includes `rank Int @default(1000)`), WeaponUnlock, Room (RoomStatus enum: WAITING/IN_RUN/FINISHED; fields: id, maxPlayers, status, createdAt, startedAt — no code or hostId), RunResult (includes rankBefore and rankAfter); verify `prisma validate` passes.
- [ ] 2.2 Create the initial migration with `prisma migrate dev --name init`; verify all tables are created in a local PostgreSQL instance.
- [ ] 2.3 Export the Prisma client from `packages/db/src/index.ts`; verify `apps/server` can import `db` and run a simple `User.count()` query.
- [ ] 2.4 Create `apps/server/src/config/weapons.json` with at least 5 weapons (id, name, damage, fireRate, xpCost — no ammoCapacity); verify the file is valid JSON with at least 2 weapons flagged `defaultUnlock: true`.
- [ ] 2.5 Create `apps/server/src/config/game.json` with in-run upgrade deltas (move_speed, reload_speed, damage step values per level-up) and rank adjustment constants; verify valid JSON.
- [ ] 2.6 Create `apps/server/src/config/waves.json` with at least 5 wave entries (startSec, endSec, spawns array with type/count/hpMultiplier); verify valid JSON and that difficulty increases across entries.



## 3. Shared Protocol Types

- [ ] 3.1 Define TypeScript interfaces in `packages/shared/src/entities.ts`: `PlayerState`, `MonsterState`, `ProjectileState`, `PickupState` matching the structures in the spec; verify no TypeScript errors.
- [ ] 3.2 Define all Client→Server WebSocket message types as a discriminated union in `packages/shared/src/messages.ts` (queue:join, queue:leave, group:create, group:join, group:leave, input:move, input:shoot, player:chooseUpgrade); verify no TypeScript errors.
- [ ] 3.3 Define all Server→Client message types as a discriminated union (queue:status, queue:cancelled, group:state, run:started, state:snapshot, player:levelUp, player:died, run:ended, error); verify no TypeScript errors.
- [ ] 3.4 Export all types from `packages/shared/src/index.ts`; verify both `apps/server` and `apps/client` can import from `@shooter/shared` without build errors.



## 4. Authentication (REST API)

- [ ] 4.1 Set up Express in `apps/server/src/rest/`; add JWT validation middleware using `jsonwebtoken` (inline or via `express-jwt`); load `JWT_SECRET` from environment; verify server starts without error.
- [ ] 4.2 Implement `POST /auth/guest`: create a User row (isGuest=true, no password), create PlayerProfile, seed 2 default WeaponUnlock rows, return a signed JWT; verify with `curl` and a DB check.
- [ ] 4.3 Implement `POST /auth/register`: validate unique username, hash password with bcrypt, create User + PlayerProfile + default unlocks, return JWT; verify 201 on success and 409 on duplicate username.
- [ ] 4.4 Implement `POST /auth/login`: find user by username, compare bcrypt hash, return JWT on match; verify 200 on valid credentials and 401 on invalid.
- [ ] 4.5 Add an Express middleware for protected routes that validates the `Authorization: Bearer <token>` header using `jsonwebtoken`; verify 401 on missing/invalid token.



## 5. Profile and Meta-Progression REST API

- [ ] 5.1 Implement `GET /profile/me`: return PlayerProfile (including rank) + WeaponUnlock list for the authenticated user; verify correct JSON shape.
- [ ] 5.2 Implement `POST /profile/weapons/unlock`: validate weaponId against `weapons.json`, check and deduct metaCurrency, insert WeaponUnlock; verify 200 on success, 409 on already-owned, 402 on insufficient funds, 400 on unknown weaponId.



## 6. WebSocket Gateway, Matchmaking, and Room Management

- [ ] 6.1 Attach a `ws` WebSocket server to the Express `http.Server` instance; authenticate the connection via JWT on upgrade (query param fallback); verify that a connection with a valid token is accepted and one without is closed.
- [ ] 6.2 Implement `GroupRegistry` singleton: stores in-memory groups (groupId → { leader, members, groupCode }); exposes `createGroup`, `joinGroup`, `leaveGroup`, `getGroup` methods; verify a 6-char groupCode is unique and a group rejects a 11th member.
- [ ] 6.3 Implement `group:create` handler: create group in GroupRegistry, respond with `group:state` including groupCode; verify group appears in registry.
- [ ] 6.4 Implement `group:join` handler: look up group by groupCode, enforce <10 members, add player, broadcast `group:state` to all members; verify GROUP_FULL and GROUP_NOT_FOUND errors.
- [ ] 6.5 Implement `group:leave` handler: remove player from group; if leader leaves, disband the group and notify remaining members; verify graceful handling.
- [ ] 6.6 Implement `RoomManager` singleton: stores a map of `roomId → GameInstance`; exposes `createRoom`, `getRoom`, `removeRoom` methods; verify unit tests for create/get/remove.
- [ ] 6.7 Implement WebSocket message router: parse incoming JSON, dispatch by `type` to the correct handler function, respond with error for unknown types; verify with integration test.
- [ ] 6.8 Implement `MatchmakingQueue` singleton: maintains a rank-sorted list of pending slots (solo or group); every 500 ms assigns slots to WAITING rooms (rank-proximity greedy); creates new rooms as needed; verify two players of similar rank end up in the same room.
- [ ] 6.9 Implement `queue:join` handler: validate weaponId is in player's unlocks, add solo player or full group to `MatchmakingQueue`, respond with `queue:status`; verify WEAPON_NOT_OWNED error.
- [ ] 6.10 Implement `queue:leave` handler: remove player (and their group slot if applicable) from the queue, respond with `queue:cancelled`; verify player is removed before room assignment.
- [ ] 6.11 Implement auto-start trigger in `MatchmakingQueue`: when a WAITING room reaches 10 players OR its timer reaches 10 s, create a `GameInstance`, update Room status to IN_RUN and set startedAt in DB, broadcast `run:started`; verify both triggers independently.
- [ ] 6.12 Implement late-join window: when assigning a new slot, prefer WAITING rooms whose startedAt timer is < 10 s before opening a new room; verify a player arriving at t=5 s joins the existing room.
- [ ] 6.13 Handle WebSocket disconnection: remove player from queue/group or mark as disconnected in-run; verify graceful handling in both phases.



## 7. Game Simulation Core (GameInstance)

- [ ] 7.1 Implement `GameInstance` class: constructor takes room players + weapon selections + permanent upgrade levels; initialises PlayerState array with HP, weapon, position; starts `setInterval` at ~50 ms; verify instance creation and tick firing.
- [ ] 7.2 Implement player movement tick: apply `input:move` dx/dy (normalised) × speed × deltaTime to player position; clamp to arena bounds; echo `seq`; verify in an isolated unit test.
- [ ] 7.3 Implement shooting: on `input:shoot` create `ProjectileState` with ownerId, position, velocity vector from angle, damage from weapon config; verify projectile is added to sim state.
- [ ] 7.4 Implement projectile movement: advance each projectile by vx/vy × deltaTime per tick; remove on out-of-bounds; verify projectile despawns at boundary.
- [ ] 7.5 Implement projectile–monster collision: circle vs circle per tick; deduct damage, remove projectile on hit; if monster HP reaches zero, remove monster and spawn an XP orb (always) and possibly a medkit (per config probability) at its last position; verify XP orb appears in sim state after kill.
- [ ] 7.6 Implement player damage from melee monsters: detect circle overlap, apply damage at configured interval, prevent rapid re-hits (cooldown per monster-player pair); verify HP decrements.
- [ ] 7.7 Implement player death: when `hp <= 0` set `isDead = true`, broadcast `player:died`, spawn XP orb at player's last position, transition player to spectator; verify broadcast fires once and XP orb appears in snapshot.
- [ ] 7.8 Implement run-end detection: after any player death, check if all players are dead; if so, snapshot each player's current rank as `rankBefore`, compute rank adjustment (±N configurable points based on waves survived vs. room average), compute results, broadcast `run:ended`, persist RunResult rows (with rankBefore and rankAfter), update PlayerProfile stats (totalRuns, bestWaves, totalKills, rank) and award metaPoints, mark Room FINISHED, stop `setInterval`; verify DB writes.
- [ ] 7.9 Implement snapshot dispatch: every snapshot interval (50 ms or configurable) serialise full state and broadcast to all room WebSocket connections; verify clients receive snapshots during a run.
- [ ] 7.10 Load in-run upgrade step values from `config/game.json` at server startup; verify the configured deltas for move_speed, reload_speed, and damage are accessible to GameInstance at run start.



## 8. Monster AI and Wave Spawner

- [ ] 8.1 Load `config/waves.json` at startup; implement `WaveSpawner` that tracks elapsed run time and spawns monster batches per the wave schedule; verify first wave fires at configured startSec.
- [ ] 8.2 Implement melee monster AI: each tick compute vector to nearest living player; move at configured speed; deal contact damage when overlapping player; verify monster reaches a stationary player and reduces HP.
- [ ] 8.3 Implement ranged monster AI: hold minimum distance from nearest player; when within firing range and cooldown elapsed, spawn a monster projectile aimed at player's position; verify projectile is created.
- [ ] 8.4 Implement swarm monster AI: same seek logic as melee but with configured higher speed and lower HP; verify batch spawn of multiple swarm units.
- [ ] 8.5 Implement monster projectile movement and player collision: advance, remove on bounds; detect player overlap, apply damage; verify player HP decrements on ranged monster attack.
- [ ] 8.6 Verify escalating difficulty: after 2× wave duration the spawned monsters have higher HP or larger batch sizes than wave 1, per the config.



## 9. Drop System

- [ ] 9.1 Implement XP orb spawn on monster death: always create an XP-orb `PickupState` at monster's last position with the monster's configured XP value; additionally roll configured probability for a medkit drop; verify XP orb always appears and medkit appears at the configured rate.
- [ ] 9.2 Implement XP orb pickup collision: per tick check each living player against each XP orb; on overlap remove orb and add its XP value to the player's in-run XP total; verify XP increments correctly.
- [ ] 9.3 Implement health pickup collision: per tick check each living player against each health pickup; on overlap remove pickup, apply heal capped at maxHp; verify HP does not exceed maxHp.
- [ ] 9.4 Implement player-death drop: when a player dies, spawn an XP orb at their last position; verify XP orb appears in snapshot immediately after death.
- [ ] 9.5 Implement pickup despawn: pickups (XP orbs and medkits) older than configured timeout are removed from sim on each tick; verify no pickups remain after timeout with no player present.



## 10. In-Run Player Progression

- [ ] 10.1 Track per-player `xp` and `level` in `PlayerState` (in-memory only); XP is added when a player collects an XP orb (handled in section 9); verify XP increments on orb collection and not on kill.
- [ ] 10.2 Detect level-up threshold: after XP changes, compare against configured XP curve; if threshold met, increment level and broadcast `{ "type": "player:levelUp", "playerId": "<id>", "choices": ["move_speed", "reload_speed", "damage"] }` to the room; verify all three options are always present.
- [ ] 10.3 Implement `player:chooseUpgrade` handler: accept `move_speed`, `reload_speed`, or `damage`; apply the corresponding stat delta (configurable per level); clear pending offer; verify invalid optionId is rejected and each valid option correctly modifies the stat.
- [ ] 10.4 Verify progression is not persisted: confirm no XP/level data is written to DB at any point during or after the run.



## 11. Input Rate Limiting

- [ ] 11.1 Track `input:*` message count per WebSocket connection per second; if count exceeds configured limit, drop excess messages for that tick; log a warning; verify excess inputs are silently dropped in a test with rapid sends.
- [ ] 11.2 Close connection after repeated rate-limit violations (configurable threshold); verify connection is closed and the player is removed from the room gracefully.



## 12. Client: Network Layer

- [ ] 12.1 Implement WebSocket client in `apps/client/src/net/wsClient.ts`: connect with JWT, reconnect on close, parse incoming JSON messages and emit to event bus; verify connection and message receipt with the running server.
- [ ] 12.2 Implement typed message senders for all Client→Server message types using shared types from `@shooter/shared`; verify TypeScript types are enforced.
- [ ] 12.3 Implement client-side prediction: on `input:move` immediately update local player position and push to a ring buffer; on `state:snapshot` find the acknowledged `seq`, correct position, replay buffered inputs; verify smooth local movement with simulated 100 ms latency.
- [ ] 12.4 Implement remote entity interpolation: maintain two snapshot buffers (prev and next); on each render frame interpolate entity positions based on elapsed time; verify remote entities move smoothly between snapshot arrivals.



## 13. Client: Auth Flow

- [ ] 13.1 Implement `AuthPage` component with "Play as Guest" and "Login / Register" options; call REST endpoints and store JWT in Zustand + localStorage; verify token is saved and user is redirected to Hub on success.
- [ ] 13.2 Implement auto-login: on app load check localStorage for a valid (non-expired) JWT; if present, skip auth and go to Hub; verify refresh-and-go-to-hub behaviour.



## 14. Client: Hub UI

- [ ] 14.1 Implement `HubPage` component: call `GET /profile/me` and display rank, metaCurrency, totalRuns, bestWaves, totalKills; verify data renders correctly.
- [ ] 14.2 Implement Weapon Unlock shop section in Hub: list weapons not yet owned with their meta-currency cost; on buy call `POST /profile/weapons/unlock` and refresh the unlocked weapons list; verify insufficient-funds and already-owned errors are displayed.
- [ ] 14.3 Implement weapon selector in Hub (active unlocked weapons as selectable cards): merged with the unlock shop — owned weapons are selectable, locked weapons show a cost and a buy button; verify at least one weapon is always selectable by default.
- [ ] 14.4 Implement weapon selector in Hub: display the player's unlocked weapons as selectable cards; highlight the active selection; verify at least one weapon is always selected by default.
- [ ] 14.5 Implement Group panel: "Create Group" button sends `group:create` and displays the received groupCode; "Join Group" form accepts a groupCode and sends `group:join`; group member list updates on `group:state`; verify GROUP_FULL and GROUP_NOT_FOUND errors are shown.
- [ ] 14.6 Implement Start button: sends `queue:join` (with weaponId and groupId if in a group); on send, show a queue-status indicator ("Finding match…") that updates on `queue:status`; verify WEAPON_NOT_OWNED error is shown if no weapon selected.



## 15. Client: Matchmaking Transition

- [ ] 15.1 Navigate to `ArenaPage` on receipt of `run:started`; display a brief "Match found!" overlay (0.5–1 s) before the arena renders; verify all players in the room transition simultaneously.



## 16. Client: PixiJS Arena Renderer

- [ ] 16.1 Create `ArenaPage` React component that mounts a `PIXI.Application` into a canvas element; start the PixiJS ticker; verify canvas renders at full browser viewport.
- [ ] 16.2 Implement player sprites: render each `PlayerState` as a coloured circle with an aim-direction indicator; update positions each PixiJS tick from the interpolated game store; verify all players render and move.
- [ ] 16.3 Implement monster sprites: render each `MonsterState` with a distinct shape/color per archetype; update each tick; verify monsters appear and move toward players.
- [ ] 16.4 Implement projectile rendering: render `ProjectileState` as small circles/lines; add and remove sprites as projectiles appear/disappear in snapshots; verify visual projectile trails.
- [ ] 16.5 Implement pickup rendering: render `PickupState` items with distinct icons/colors per type (XP orb=yellow, medkit=green); remove on collection; verify pickups appear and disappear.
- [ ] 16.6 Implement keyboard + mouse input capture: WASD → `input:move` at each render frame; mouse position → aim angle → `input:shoot` on click/space; verify messages are sent to server.
- [ ] 16.7 Implement arena boundary rendering: draw a visible rectangular arena border; verify player is visually clamped at edges.
- [ ] 16.8 Implement camera: centre the viewport on the local player; verify the camera follows the local player smoothly.



## 17. Client: HUD and Overlays

- [ ] 17.1 Implement React HUD overlay (rendered on top of the PixiJS canvas): display local player HP bar, current level, XP bar (no ammo count); subscribe to a Zustand game-state slice updated by the WS handler; verify HP and XP update in real time.
- [ ] 17.2 Implement wave counter and kill count in HUD; verify values update as monsters are killed.
- [ ] 17.3 Implement `UpgradeChoiceModal`: rendered when `player:levelUp` is received; display 3 upgrade option cards; on selection send `player:chooseUpgrade` and dismiss modal; verify modal blocks input until a choice is made.
- [ ] 17.4 Implement spectator overlay: when local player dies, show "You died — watching" banner; continue rendering arena; verify banner appears and arena keeps updating.
- [ ] 17.5 Implement `ResultsScreen`: rendered on `run:ended`; display per-player stats (waves, kills, survival time, meta-points earned); show "Return to Hub" button that navigates back and refreshes profile; verify meta-points are reflected in Hub after return.



## 18. End-to-End Verification

- [ ] 18.1 Run through full solo guest flow: guest login → hub (select weapon) → press Start → queue → match found → arena → kill monsters → level up + choose upgrade → die → spectator → run ends → results → hub with updated meta-currency and rank; verify no errors at any step.
- [ ] 18.2 Run a 2-player group flow: player A creates a group, shares groupCode, player B joins via groupCode; both select weapons; leader presses Start; both end up in the same room and see each other's positions in real time (verify via devtools showing consistent snapshots).
- [ ] 18.3 Verify auto-start timer: one player joins queue; confirm the run starts within ~10 s even without a second player.
- [ ] 18.4 Verify late-join window: player A queues at t=0, player B queues at t=7 s; confirm B joins A's room rather than a new one; player C queues at t=12 s and goes to a new room.
- [ ] 18.5 Verify server-authoritative hit detection: send artificially delayed inputs; confirm that kills and damage are always resolved by the server and reflected correctly in snapshots.
- [ ] 18.6 Verify client-side prediction: with simulated 100 ms RTT, local player movement feels instant; verify no visible "rubber banding" on stable connection.
- [ ] 18.7 Verify wave escalation: let a run run for 3+ minutes and confirm later waves visibly spawn more / tougher monsters per `waves.json` config.
- [ ] 18.8 Verify meta-progression and rank persistence: complete a run, disconnect, reconnect; confirm rank on profile changed in the expected direction and the RunResult row contains correct rankBefore and rankAfter values.