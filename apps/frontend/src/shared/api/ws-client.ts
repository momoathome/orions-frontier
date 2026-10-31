import type { RealtimeEvents, RealtimeEventType } from '@orions-frontier/shared';
import { expireSession } from './api-client.js';

type ClientMessage = { type: 'authenticate'; payload: { token: string } } | { type: 'ping' };
interface ServerMessage {
  type: string;
  payload?: object;
}

/** Local event after a dropped connection is authenticated again; events in the gap are lost. */
const RECONNECTED = 'local:reconnected';
const MAX_RECONNECT_DELAY_MS = 30_000;
// A half-open socket never answers; closing it hands over to reconnect().
const PONG_TIMEOUT_MS = 10_000;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private messageHandlers = new Map<string, Set<(payload: object) => void>>();
  private pingInterval: number | null = null;
  private pongTimer: number | null = null;
  private wasAuthenticated = false;

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
            if (this.wasAuthenticated) this.emit(RECONNECTED);
            this.wasAuthenticated = true;
          } else if (message.type === 'pong') {
            this.clearPongTimer();
          } else {
            this.emit(message.type, message.payload);
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
        if (event.code === 4401) expireSession();
        else this.reconnect();
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
    return this.subscribe(type, (payload) => {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Server und Client teilen `RealtimeEvents`; die Zuordnung type→payload garantiert publishUserEvent.
      callback(payload as RealtimeEvents[K]);
    });
  }

  /** Fires after a reconnect; reload whatever realtime events keep current. */
  onReconnected(callback: () => void): () => void {
    return this.subscribe(RECONNECTED, callback);
  }

  private subscribe(type: string, handler: (payload: object) => void): () => void {
    const handlers = this.messageHandlers.get(type) ?? new Set();
    handlers.add(handler);
    this.messageHandlers.set(type, handlers);
    return () => handlers.delete(handler);
  }

  private emit(type: string, payload: object = {}) {
    this.messageHandlers.get(type)?.forEach((handler) => {
      handler(payload);
    });
  }

  private startPing() {
    this.stopPing();
    this.pingInterval = window.setInterval(() => {
      this.send({ type: 'ping' });
      this.clearPongTimer();
      this.pongTimer = window.setTimeout(() => this.ws?.close(), PONG_TIMEOUT_MS);
    }, 30_000);
  }

  private stopPing() {
    if (this.pingInterval !== null) clearInterval(this.pingInterval);
    this.pingInterval = null;
    this.clearPongTimer();
  }

  private clearPongTimer() {
    if (this.pongTimer !== null) clearTimeout(this.pongTimer);
    this.pongTimer = null;
  }

  /** Retries until disconnect(): 1 s, 2 s, 4 s … capped at 30 s. */
  private reconnect() {
    if (!this.token) return;
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1_000 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.token) this.connectSocket();
    }, delay);
  }

  send(message: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  disconnect() {
    this.token = null;
    this.reconnectAttempts = 0;
    this.wasAuthenticated = false;
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
