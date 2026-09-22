export const ARENA_WIDTH = 2400;
export const ARENA_HEIGHT = 1600;
export const PLAYER_RADIUS = 16;
export const PROJECTILE_RADIUS = 4;
export const PICKUP_RADIUS = 12;
export const AIM_LENGTH = 26;
export const PROJECTILE_TRAIL_LENGTH = 16;

export const PLAYER_PALETTE = [
  0x3d8bfd, 0x2f9e6b, 0xf0a202, 0xe85d4c, 0xc084fc, 0x22d3ee, 0xf472b6, 0xa3e635,
] as const;

export const LOCAL_PLAYER_COLOR = 0x3d8bfd;

export const MONSTER_STYLE = {
  melee: { shape: 'circle' as const, color: 0xe85d4c, radius: 16 },
  ranged: { shape: 'triangle' as const, color: 0xf0a202, radius: 16 },
  swarm: { shape: 'square' as const, color: 0xc084fc, radius: 10 },
};

export const PICKUP_STYLE = {
  xp_orb: { color: 0xffd24a, shape: 'orb' as const },
  medkit: { color: 0x3dcc7a, shape: 'cross' as const },
};

export const ARENA_FILL = 0x121a24;
export const ARENA_BORDER = 0x7ea0c4;
export const ARENA_BORDER_WIDTH = 6;

export function colorForId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return PLAYER_PALETTE[hash % PLAYER_PALETTE.length] ?? LOCAL_PLAYER_COLOR;
}
