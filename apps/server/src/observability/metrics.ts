import { Counter, Gauge, Histogram, register } from 'prom-client';

const sources = {
  connectedPlayers: (): number => 0,
  rooms: (): number => 0,
};

export function setMetricsSources(next: {
  connectedPlayers: () => number;
  rooms: () => number;
}): void {
  sources.connectedPlayers = next.connectedPlayers;
  sources.rooms = next.rooms;
}

new Gauge({
  name: 'shooter_connected_players',
  help: 'Number of connected players',
  collect() {
    this.set(sources.connectedPlayers());
  },
});

new Gauge({
  name: 'shooter_rooms',
  help: 'Number of active rooms',
  collect() {
    this.set(sources.rooms());
  },
});

export const matchmakingFailures = new Counter({
  name: 'shooter_matchmaking_failures_total',
  help: 'Number of matchmaking tick failures',
});

export const tickDuration = new Histogram({
  name: 'shooter_tick_duration_seconds',
  help: 'Duration of GameInstance.tick in seconds',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
});

export function metricsContentType(): string {
  return register.contentType;
}

export function renderMetrics(): Promise<string> {
  return register.metrics();
}
