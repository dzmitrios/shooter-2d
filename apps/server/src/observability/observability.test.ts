import assert from 'node:assert/strict';
import http from 'node:http';
import { Writable } from 'node:stream';
import { describe, it } from 'node:test';
import type { Express } from 'express';
import * as Sentry from '@sentry/node';
import { createLogger, logListening } from './logger.js';
import { renderMetrics } from './metrics.js';
import { closeSentry, initSentry, isSentryEnabled } from './sentry.js';
import { createApp } from '../rest/app.js';

function listen(app: Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('expected a TCP port'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}

describe('server observability', () => {
  it('writes a startup line as JSON with level, time, and the listen port', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    logListening(4123, createLogger(stream));
    const parsed: unknown = JSON.parse(lines.join('').trim());
    assert.equal(typeof parsed, 'object');
    assert.ok(parsed);
    assert.ok('level' in parsed);
    assert.ok('time' in parsed);
    assert.ok('message' in parsed);
    assert.match(String((parsed as { message: unknown }).message), /4123/);
  });

  it('serves a route when SENTRY_DSN is unset', async () => {
    const previous = process.env['SENTRY_DSN'];
    delete process.env['SENTRY_DSN'];
    await closeSentry();
    try {
      initSentry();
      assert.equal(isSentryEnabled(), false);
      const app = createApp({
        extraRoutes(expressApp) {
          expressApp.get('/ready', (_req, res) => {
            res.status(200).json({ ok: true });
          });
        },
      });
      const server = await listen(app);
      try {
        const response = await fetch(`${server.url}/ready`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true });
      } finally {
        await server.close();
      }
    } finally {
      if (previous === undefined) {
        delete process.env['SENTRY_DSN'];
      } else {
        process.env['SENTRY_DSN'] = previous;
      }
    }
  });

  it('reports a thrown handler when SENTRY_DSN is set without a live request', async () => {
    const previous = process.env['SENTRY_DSN'];
    process.env['SENTRY_DSN'] = 'https://public@example.invalid/1';
    const sent: string[] = [];
    await closeSentry();
    try {
      initSentry({
        defaultIntegrations: false,
        transport: () => ({
          send(envelope) {
            sent.push(JSON.stringify(envelope));
            return Promise.resolve({});
          },
          flush() {
            return Promise.resolve(true);
          },
        }),
      });
      const app = createApp({
        extraRoutes(expressApp) {
          expressApp.get('/boom', () => {
            throw new Error('sentry-test-boom');
          });
        },
      });
      const server = await listen(app);
      try {
        const response = await fetch(`${server.url}/boom`);
        assert.equal(response.status, 500);
        await Sentry.flush(2000);
        assert.ok(sent.some((body) => body.includes('sentry-test-boom')));
      } finally {
        await server.close();
      }
    } finally {
      await closeSentry();
      if (previous === undefined) {
        delete process.env['SENTRY_DSN'];
      } else {
        process.env['SENTRY_DSN'] = previous;
      }
    }
  });

  it('returns Prometheus text for player, room, matchmaking, and tick series', async () => {
    const app = createApp();
    const server = await listen(app);
    try {
      const response = await fetch(`${server.url}/metrics`);
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.equal(body, await renderMetrics());
      assert.match(body, /shooter_connected_players/);
      assert.match(body, /shooter_rooms/);
      assert.match(body, /shooter_matchmaking_failures_total/);
      assert.match(body, /shooter_tick_duration_seconds/);
    } finally {
      await server.close();
    }
  });
});
