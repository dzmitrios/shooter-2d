export interface PredictionConfig {
  speed: number;
  radius: number;
  arenaWidth: number;
  arenaHeight: number;
}

export const DEFAULT_PREDICTION_CONFIG: PredictionConfig = {
  speed: 160,
  radius: 16,
  arenaWidth: 2400,
  arenaHeight: 1600,
};

export interface MoveInput {
  seq: number;
  dx: number;
  dy: number;
  t: number;
  dt: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

const RING_CAPACITY = 256;

export class LocalPredictor {
  x = 0;
  y = 0;
  private readonly buffer: MoveInput[] = [];
  private head = 0;
  private count = 0;

  constructor(private config: PredictionConfig = DEFAULT_PREDICTION_CONFIG) {}

  setSpeed(speed: number): void {
    this.config = { ...this.config, speed };
  }

  reset(position: Vec2): void {
    this.x = position.x;
    this.y = position.y;
    this.head = 0;
    this.count = 0;
  }

  applyMove(seq: number, dx: number, dy: number, t: number, dt: number): Vec2 {
    const n = normalize(dx, dy);
    this.push({ seq, dx: n.dx, dy: n.dy, t, dt });
    this.integrate(n.dx, n.dy, dt);
    return { x: this.x, y: this.y };
  }

  reconcile(server: { x: number; y: number; seq: number }): Vec2 {
    this.x = server.x;
    this.y = server.y;
    this.dropAcked(server.seq);
    for (const input of this.unacked()) {
      this.integrate(input.dx, input.dy, input.dt);
    }
    return { x: this.x, y: this.y };
  }

  unacked(): MoveInput[] {
    const items: MoveInput[] = [];
    for (let i = 0; i < this.count; i += 1) {
      const item = this.buffer[(this.head + i) % RING_CAPACITY];
      if (item) {
        items.push(item);
      }
    }
    return items;
  }

  private push(input: MoveInput): void {
    if (this.count === RING_CAPACITY) {
      this.head = (this.head + 1) % RING_CAPACITY;
      this.count -= 1;
    }
    this.buffer[(this.head + this.count) % RING_CAPACITY] = input;
    this.count += 1;
  }

  private dropAcked(seq: number): void {
    while (this.count > 0) {
      const oldest = this.buffer[this.head % RING_CAPACITY];
      if (!oldest || oldest.seq > seq) {
        break;
      }
      this.head = (this.head + 1) % RING_CAPACITY;
      this.count -= 1;
    }
  }

  private integrate(dx: number, dy: number, dt: number): void {
    this.x += dx * this.config.speed * dt;
    this.y += dy * this.config.speed * dt;
    this.x = clamp(this.x, this.config.radius, this.config.arenaWidth - this.config.radius);
    this.y = clamp(this.y, this.config.radius, this.config.arenaHeight - this.config.radius);
  }
}

export function normalize(dx: number, dy: number): { dx: number; dy: number } {
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return { dx: 0, dy: 0 };
  }
  return { dx: dx / length, dy: dy / length };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
