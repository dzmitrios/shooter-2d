import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PREDICTION_CONFIG, LocalPredictor } from './prediction.ts';

describe('LocalPredictor', () => {
  it('updates local position immediately on input:move', () => {
    const predictor = new LocalPredictor();
    predictor.reset({ x: 100, y: 200 });
    const after = predictor.applyMove(1, 1, 0, 0, 0.05);
    const expected = 100 + DEFAULT_PREDICTION_CONFIG.speed * 0.05;
    assert.equal(after.x, expected);
    assert.equal(after.y, 200);
  });

  it('reconciles against an acknowledged seq and replays unacked inputs', () => {
    const predictor = new LocalPredictor();
    predictor.reset({ x: 100, y: 100 });
    const dt = 0.02;
    predictor.applyMove(1, 1, 0, 0, dt);
    predictor.applyMove(2, 1, 0, 20, dt);
    predictor.applyMove(3, 1, 0, 40, dt);

    const predicted = { x: predictor.x, y: predictor.y };
    const ackedX = 100 + DEFAULT_PREDICTION_CONFIG.speed * dt;
    const after = predictor.reconcile({ x: ackedX, y: 100, seq: 1 });

    assert.ok(Math.abs(after.x - predicted.x) < 1e-9);
    assert.equal(after.y, 100);
    assert.equal(predictor.unacked().map((input) => input.seq).join(','), '2,3');
  });

  it('keeps predicted movement smooth with 100 ms snapshot delay', () => {
    const predictor = new LocalPredictor();
    const start = { x: 400, y: 400 };
    predictor.reset(start);
    const dt = 0.02;
    const latencyMs = 100;
    const inputs: { seq: number; t: number }[] = [];

    for (let t = 0, seq = 1; t < latencyMs; t += 20, seq += 1) {
      predictor.applyMove(seq, 1, 0, t, dt);
      inputs.push({ seq, t });
    }

    const predicted = { x: predictor.x, y: predictor.y };
    const ackedCount = Math.floor(latencyMs / 20 / 2);
    const ackedSeq = inputs[ackedCount - 1]?.seq ?? 1;
    const serverX = start.x + DEFAULT_PREDICTION_CONFIG.speed * dt * ackedCount;

    const delayed = new LocalPredictor();
    delayed.reset(start);
    for (const input of inputs) {
      delayed.applyMove(input.seq, 1, 0, input.t, dt);
    }
    const reconciled = delayed.reconcile({ x: serverX, y: start.y, seq: ackedSeq });

    assert.ok(Math.abs(reconciled.x - predicted.x) < 1e-9);
    assert.equal(reconciled.y, predicted.y);
  });

  it('applies movement immediately and does not rubber-band at 100 ms RTT', () => {
    const predictor = new LocalPredictor();
    const start = { x: 400, y: 400 };
    predictor.reset(start);

    const dt = 0.05;
    const speed = DEFAULT_PREDICTION_CONFIG.speed;
    const oneWayFrames = 1;
    const pending: Array<{ deliverAt: number; seq: number; dx: number; dy: number; dt: number }> = [];
    const snapshots: Array<{ deliverAt: number; x: number; y: number; seq: number }> = [];

    let serverX = start.x;
    const serverY = start.y;
    let maxCorrection = 0;
    let instantSteps = 0;

    for (let frame = 0; frame < 40; frame += 1) {
      const seq = frame + 1;
      const before = predictor.x;
      predictor.applyMove(seq, 1, 0, frame * 50, dt);
      assert.ok(predictor.x > before);
      instantSteps += 1;
      pending.push({ deliverAt: frame + oneWayFrames, seq, dx: 1, dy: 0, dt });

      for (const input of pending.filter((item) => item.deliverAt === frame)) {
        serverX += input.dx * speed * input.dt;
        snapshots.push({
          deliverAt: frame + oneWayFrames,
          x: serverX,
          y: serverY,
          seq: input.seq,
        });
      }

      for (const snapshot of snapshots.filter((item) => item.deliverAt === frame)) {
        const pre = predictor.x;
        const after = predictor.reconcile(snapshot);
        maxCorrection = Math.max(maxCorrection, Math.abs(after.x - pre));
      }
    }

    assert.equal(instantSteps, 40);
    assert.ok(maxCorrection < 1e-6);
    assert.ok(predictor.x > start.x);
    assert.equal(predictor.y, serverY);
  });

  it('clamps predicted position to the arena', () => {
    const predictor = new LocalPredictor({
      ...DEFAULT_PREDICTION_CONFIG,
      arenaWidth: 200,
      arenaHeight: 200,
      radius: 16,
    });
    predictor.reset({ x: 180, y: 100 });
    const after = predictor.applyMove(1, 1, 0, 0, 5);
    assert.equal(after.x, 200 - 16);
  });
});
