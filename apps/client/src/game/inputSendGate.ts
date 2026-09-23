/** Tick-driven input messages (`input:move`, `input:shoot`) are sent at most this often. */
export const INPUT_SEND_HZ = 20;
export const INPUT_SEND_INTERVAL_MS = 1000 / INPUT_SEND_HZ;

export class InputSendGate {
  private nextMoveAt = Number.NEGATIVE_INFINITY;
  private nextShootAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly intervalMs = INPUT_SEND_INTERVAL_MS) {}

  allowMove(now: number): boolean {
    if (now < this.nextMoveAt) {
      return false;
    }
    this.nextMoveAt = now + this.intervalMs;
    return true;
  }

  allowShoot(now: number): boolean {
    if (now < this.nextShootAt) {
      return false;
    }
    this.nextShootAt = now + this.intervalMs;
    return true;
  }
}
