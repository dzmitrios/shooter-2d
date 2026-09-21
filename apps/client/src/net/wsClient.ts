import type { ClientMessage, ServerMessage } from '@shooter/shared';

const WS_OPEN = 1;

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

export type ServerMessageHandler<T extends ServerMessage = ServerMessage> = (
  message: T,
) => void;

export class MessageBus {
  private readonly typed = new Map<string, Set<ServerMessageHandler>>();
  private readonly any = new Set<ServerMessageHandler>();

  on<T extends ServerMessage['type']>(
    type: T,
    handler: ServerMessageHandler<Extract<ServerMessage, { type: T }>>,
  ): () => void {
    let handlers = this.typed.get(type);
    if (!handlers) {
      handlers = new Set();
      this.typed.set(type, handlers);
    }
    handlers.add(handler as ServerMessageHandler);
    return () => {
      handlers?.delete(handler as ServerMessageHandler);
    };
  }

  onAny(handler: ServerMessageHandler): () => void {
    this.any.add(handler);
    return () => {
      this.any.delete(handler);
    };
  }

  emit(message: ServerMessage): void {
    for (const handler of this.any) {
      handler(message);
    }
    const handlers = this.typed.get(message.type);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      handler(message);
    }
  }
}

export interface WsClientOptions {
  url: string;
  token: string;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  WebSocketImpl?: WebSocketConstructor;
  onOpen?: () => void;
  onClose?: () => void;
}

export class WsClient {
  readonly bus = new MessageBus();

  private socket: WebSocketLike | null = null;
  private generation = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private closedByUser = false;
  private readonly url: string;
  private readonly token: string;
  private readonly reconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly WebSocketImpl: WebSocketConstructor;
  private readonly onOpen?: () => void;
  private readonly onClose?: () => void;

  constructor(options: WsClientOptions) {
    this.url = options.url;
    this.token = options.token;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 500;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 5000;
    this.WebSocketImpl =
      options.WebSocketImpl ??
      (globalThis.WebSocket as unknown as WebSocketConstructor);
    this.onOpen = options.onOpen;
    this.onClose = options.onClose;
  }

  get connected(): boolean {
    return this.socket?.readyState === WS_OPEN;
  }

  connect(): void {
    this.closedByUser = false;
    this.openSocket();
  }

  disconnect(): void {
    this.closedByUser = true;
    this.generation += 1;
    this.clearReconnect();
    this.socket?.close();
    this.socket = null;
  }

  send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WS_OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  private openSocket(): void {
    this.clearReconnect();
    this.generation += 1;
    const generation = this.generation;
    this.socket?.close();

    const socket = new this.WebSocketImpl(this.socketUrl());
    this.socket = socket;

    socket.onopen = () => {
      if (generation !== this.generation) {
        return;
      }
      this.attempts = 0;
      this.onOpen?.();
    };

    socket.onmessage = (event) => {
      if (generation !== this.generation) {
        return;
      }
      const message = parseServerMessage(event.data);
      if (message) {
        this.bus.emit(message);
      }
    };

    socket.onclose = () => {
      if (generation !== this.generation) {
        return;
      }
      this.onClose?.();
      this.socket = null;
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      if (generation !== this.generation) {
        return;
      }
      socket.close();
    };
  }

  private socketUrl(): string {
    const separator = this.url.includes('?') ? '&' : '?';
    return `${this.url}${separator}token=${encodeURIComponent(this.token)}`;
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) {
      return;
    }
    this.clearReconnect();
    const delay = Math.min(
      this.maxReconnectDelayMs,
      this.reconnectDelayMs * 2 ** this.attempts,
    );
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.closedByUser) {
        this.openSocket();
      }
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}

export function parseServerMessage(data: unknown): ServerMessage | null {
  const text = toText(data);
  if (text === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { type?: unknown }).type !== 'string'
    ) {
      return null;
    }
    return parsed as ServerMessage;
  } catch {
    return null;
  }
}

function toText(data: unknown): string | null {
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  return null;
}
