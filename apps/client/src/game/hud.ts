import type { UpgradeOptionId, WaveConfig } from '@shooter/shared';

export const SNAPSHOT_TICK_MS = 50;

/** Matches `apps/server/src/config/game.json` xpCurve. */
export const XP_CURVE = [0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700];

export const UPGRADE_LABELS: Record<UpgradeOptionId, string> = {
  move_speed: 'Movement speed',
  reload_speed: 'Reload speed',
  damage: 'Damage',
};

export function waveFromTick(tick: number, waves: WaveConfig[]): number {
  if (waves.length === 0) {
    return 1;
  }
  const elapsedSec = (tick * SNAPSHOT_TICK_MS) / 1000;
  let count = 0;
  for (const wave of waves) {
    if (elapsedSec >= wave.startSec) {
      count += 1;
    }
  }
  return Math.max(count, 1);
}

export function xpBar(xp: number, level: number): { current: number; next: number; ratio: number } {
  const prev = XP_CURVE[Math.min(level - 1, XP_CURVE.length - 1)] ?? 0;
  const next = XP_CURVE[Math.min(level, XP_CURVE.length - 1)] ?? prev;
  const span = Math.max(next - prev, 1);
  const current = Math.max(0, xp - prev);
  return {
    current,
    next: span,
    ratio: Math.min(1, current / span),
  };
}
