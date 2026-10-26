import type { RealtimeEvents, RealtimeEventType } from '@orions-frontier/shared';

type ClientMessage = { type: 'authenticate'; payload: { token: string } } | { type: 'ping' };
interface ServerMessage {
  type: string;
  payload?: object;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private messageHandlers = new Map<string, Set<(payload: object) => void>>();
  private pingInterval: number | null = null;

  constructor(private url: string) {}

  connect(token: string) {
    this.disconnect();
    this.token = token;
    this.connectSocket();
  }

  private connectSocket() {
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        if (this.token) this.send({ type: 'authenticate', payload: { token: this.token } });
      };
      this.ws.onmessage = (event) => {
        try {
          if (typeof event.data !== 'string') return;
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- eigener Server, Format siehe apps/api/src/lib/realtime.ts.
          const message = JSON.parse(event.data) as ServerMessage;
          if (message.type === 'authenticated') {
            this.startPing();
          } else if (message.type !== 'pong') {
            this.messageHandlers.get(message.type)?.forEach((handler) => {
              handler(message.payload ?? {});
            });
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
      this.ws.onclose = (event) => {
        this.stopPing();
        if (event.code !== 4401) this.reconnect();
      };
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      this.reconnect();
    }
  }

  on<K extends RealtimeEventType>(
    type: K,
    callback: (payload: RealtimeEvents[K]) => void
  ): () => void {
    const handlers = this.messageHandlers.get(type) ?? new Set();

    const handler = (payload: object) => {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Server und Client teilen `RealtimeEvents`; die Zuordnung type→payload garantiert publishUserEvent.
      callback(payload as RealtimeEvents[K]);
    };
    handlers.add(handler);
    this.messageHandlers.set(type, handlers);
    return () => handlers.delete(handler);
  }

  private startPing() {
    this.stopPing();
    this.pingInterval = window.setInterval(() => {
      this.send({ type: 'ping' });
    }, 30_000);
  }

  private stopPing() {
    if (this.pingInterval !== null) clearInterval(this.pingInterval);
    this.pingInterval = null;
  }

  private reconnect() {
    if (!this.token || this.reconnectAttempts >= 5) return;
    this.reconnectAttempts++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.token) this.connectSocket();
    }, 1_000 * this.reconnectAttempts);
  }

  send(message: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  disconnect() {
    this.token = null;
    this.reconnectAttempts = 0;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopPing();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

const WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:3000`;
export const wsClient = new WebSocketClient(WS_URL);
