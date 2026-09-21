import type { InputRateLimitConfig } from '../config/index.js';

export type InputRateLimitAction = 'allow' | 'drop' | 'kick';

export interface InputRateLimitDecision {
  action: InputRateLimitAction;
  warn: boolean;
}

interface ConnectionWindow {
  windowStartMs: number;
  count: number;
  violations: number;
}

export class InputRateLimiter {
  private readonly windows = new Map<string, ConnectionWindow>();

  constructor(
    private readonly config: InputRateLimitConfig,
    private readonly now: () => number = Date.now,
  ) {}

  consume(connectionId: string): InputRateLimitDecision {
    const now = this.now();
    let state = this.windows.get(connectionId);
    if (!state || now - state.windowStartMs >= 1000) {
      state = {
        windowStartMs: now,
        count: 0,
        violations: state?.violations ?? 0,
      };
      this.windows.set(connectionId, state);
    }

    state.count += 1;
    if (state.count <= this.config.maxPerSecond) {
      return { action: 'allow', warn: false };
    }

    const firstExcess = state.count === this.config.maxPerSecond + 1;
    if (firstExcess) {
      state.violations += 1;
    }

    if (state.violations >= this.config.violationThreshold) {
      return { action: 'kick', warn: firstExcess };
    }
    return { action: 'drop', warn: firstExcess };
  }

  forget(connectionId: string): void {
    this.windows.delete(connectionId);
  }
}
