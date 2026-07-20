export class WebSocketClient {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private messageHandlers = new Map<string, Set<(payload: unknown) => void>>();
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
        this.send({ type: 'authenticate', payload: { token: this.token } });
      };
      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as { type: string; payload?: unknown };
          if (message.type === 'authenticated') {
            this.startPing();
          } else if (message.type !== 'pong') {
            this.messageHandlers.get(message.type)?.forEach((handler) => handler(message.payload));
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
      this.ws.onerror = (error) => console.error('WebSocket error:', error);
      this.ws.onclose = (event) => {
        this.stopPing();
        if (event.code !== 4401) this.reconnect();
      };
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      this.reconnect();
    }
  }

  on(type: string, callback: (payload: unknown) => void): () => void {
    const handlers = this.messageHandlers.get(type) ?? new Set();
    handlers.add(callback);
    this.messageHandlers.set(type, handlers);
    return () => handlers.delete(callback);
  }

  private startPing() {
    this.stopPing();
    this.pingInterval = window.setInterval(() => this.send({ type: 'ping' }), 30_000);
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

  send(message: unknown) {
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
