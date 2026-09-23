import * as Sentry from '@sentry/node';
import type { NodeOptions } from '@sentry/node';

let enabled = false;

export function initSentry(options?: {
  transport?: NodeOptions['transport'];
  defaultIntegrations?: false;
}): void {
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) {
    enabled = false;
    return;
  }

  Sentry.init({
    dsn,
    skipOpenTelemetrySetup: true,
    ...(options?.transport ? { transport: options.transport } : {}),
    ...(options?.defaultIntegrations === false ? { defaultIntegrations: false as const } : {}),
  });
  enabled = true;
}

export function reportError(err: unknown): void {
  if (!enabled) {
    return;
  }
  Sentry.captureException(err);
}

export function isSentryEnabled(): boolean {
  return enabled;
}

export async function closeSentry(): Promise<void> {
  enabled = false;
  if (Sentry.isInitialized()) {
    await Sentry.close(0);
  }
}
