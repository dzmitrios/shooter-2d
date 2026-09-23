import pino, { type DestinationStream, type Logger } from 'pino';

const options = { messageKey: 'message' } as const;

export function createLogger(destination?: DestinationStream): Logger {
  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger();

export function logListening(port: number, log: Logger = logger): void {
  log.info(`Server listening on port ${port}`);
}
