import type { MonsterType, WaveConfig } from '@shooter/shared';

export interface WaveSpawnRequest {
  type: MonsterType;
  hpMultiplier: number;
  x: number;
  y: number;
}

export interface WaveSpawnerOptions {
  width: number;
  height: number;
  inset: number;
  clusterSpread: number;
  random?: () => number;
}

export class WaveSpawner {
  private readonly spawned = new Set<number>();
  private readonly random: () => number;

  constructor(
    private readonly waves: WaveConfig[],
    private readonly options: WaveSpawnerOptions,
  ) {
    this.random = options.random ?? Math.random;
  }

  collectSpawns(elapsedSec: number): WaveSpawnRequest[] {
    const spawned: WaveSpawnRequest[] = [];
    this.waves.forEach((wave, index) => {
      if (elapsedSec < wave.startSec || this.spawned.has(index)) {
        return;
      }
      this.spawned.add(index);
      spawned.push(...this.buildWave(wave));
    });
    return spawned;
  }

  private buildWave(wave: WaveConfig): WaveSpawnRequest[] {
    const spawned: WaveSpawnRequest[] = [];
    for (const entry of wave.spawns) {
      const origin = this.pickEdgeOrigin();
      for (let i = 0; i < entry.count; i += 1) {
        spawned.push({
          type: entry.type,
          hpMultiplier: entry.hpMultiplier,
          ...this.offsetFromOrigin(origin),
        });
      }
    }
    return spawned;
  }

  private pickEdgeOrigin(): { x: number; y: number } {
    const { width, height, inset } = this.options;
    const edge = Math.floor(this.random() * 4) % 4;
    if (edge === 0) {
      return { x: inset + this.random() * Math.max(width - 2 * inset, 0), y: inset };
    }
    if (edge === 1) {
      return { x: width - inset, y: inset + this.random() * Math.max(height - 2 * inset, 0) };
    }
    if (edge === 2) {
      return { x: inset + this.random() * Math.max(width - 2 * inset, 0), y: height - inset };
    }
    return { x: inset, y: inset + this.random() * Math.max(height - 2 * inset, 0) };
  }

  private offsetFromOrigin(origin: { x: number; y: number }): { x: number; y: number } {
    const { width, height, inset, clusterSpread } = this.options;
    const x = clamp(
      origin.x + (this.random() - 0.5) * 2 * clusterSpread,
      inset,
      width - inset,
    );
    const y = clamp(
      origin.y + (this.random() - 0.5) * 2 * clusterSpread,
      inset,
      height - inset,
    );
    return { x, y };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
