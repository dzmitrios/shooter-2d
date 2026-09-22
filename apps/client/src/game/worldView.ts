import type { InterpolatedWorld } from '../net/interpolation.ts';
import {
  AIM_LENGTH,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  LOCAL_PLAYER_COLOR,
  MONSTER_STYLE,
  PICKUP_RADIUS,
  PICKUP_STYLE,
  PLAYER_RADIUS,
  PROJECTILE_RADIUS,
  PROJECTILE_TRAIL_LENGTH,
  colorForId,
} from './constants.ts';

export interface BoundsDrawable {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlayerDrawable {
  id: string;
  x: number;
  y: number;
  angle: number;
  radius: number;
  color: number;
  aimLength: number;
  local: boolean;
}

export interface MonsterDrawable {
  id: string;
  x: number;
  y: number;
  type: keyof typeof MONSTER_STYLE;
  shape: (typeof MONSTER_STYLE)[keyof typeof MONSTER_STYLE]['shape'];
  color: number;
  radius: number;
}

export interface ProjectileDrawable {
  id: string;
  x: number;
  y: number;
  radius: number;
  trailX: number;
  trailY: number;
}

export interface PickupDrawable {
  id: string;
  x: number;
  y: number;
  type: keyof typeof PICKUP_STYLE;
  color: number;
  radius: number;
  shape: (typeof PICKUP_STYLE)[keyof typeof PICKUP_STYLE]['shape'];
}

export interface WorldView {
  bounds: BoundsDrawable;
  players: PlayerDrawable[];
  monsters: MonsterDrawable[];
  projectiles: ProjectileDrawable[];
  pickups: PickupDrawable[];
}

export function buildWorldView(world: InterpolatedWorld, localUserId: string | null): WorldView {
  return {
    bounds: { x: 0, y: 0, width: ARENA_WIDTH, height: ARENA_HEIGHT },
    players: world.players.map((player) => {
      const local = localUserId !== null && (player.userId === localUserId || player.id === localUserId);
      return {
        id: player.id,
        x: player.x,
        y: player.y,
        angle: player.angle,
        radius: PLAYER_RADIUS,
        color: local ? LOCAL_PLAYER_COLOR : colorForId(player.userId || player.id),
        aimLength: AIM_LENGTH,
        local,
      };
    }),
    monsters: world.monsters.map((monster) => {
      const style = MONSTER_STYLE[monster.type];
      return {
        id: monster.id,
        x: monster.x,
        y: monster.y,
        type: monster.type,
        shape: style.shape,
        color: style.color,
        radius: style.radius,
      };
    }),
    projectiles: world.projectiles.map((projectile) => {
      const speed = Math.hypot(projectile.vx, projectile.vy) || 1;
      return {
        id: projectile.id,
        x: projectile.x,
        y: projectile.y,
        radius: PROJECTILE_RADIUS,
        trailX: projectile.x - (projectile.vx / speed) * PROJECTILE_TRAIL_LENGTH,
        trailY: projectile.y - (projectile.vy / speed) * PROJECTILE_TRAIL_LENGTH,
      };
    }),
    pickups: world.pickups.map((pickup) => {
      const style = PICKUP_STYLE[pickup.type];
      return {
        id: pickup.id,
        x: pickup.x,
        y: pickup.y,
        type: pickup.type,
        color: style.color,
        radius: PICKUP_RADIUS,
        shape: style.shape,
      };
    }),
  };
}
