export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

export interface PingStats {
  lastPing: number | null;
  lastPong: number | null;
  latency: number | null;
  status: ConnectionStatus;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: number | null = null;
  private pingStats: PingStats = {
    lastPing: null,
    lastPong: null,
    latency: null,
    status: 'disconnected',
  };
  private statusCallbacks: Set<(stats: PingStats) => void> = new Set();

  constructor(private url: string) {}

  connect() {
    try {
      this.updateStatus('connecting');
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        this.updateStatus('connected');
        this.startPing();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          // Handle pong response
          if (message.type === 'pong') {
            const now = Date.now();
            this.pingStats.lastPong = now;
            if (this.pingStats.lastPing) {
              this.pingStats.latency = now - this.pingStats.lastPing;
            }
            this.notifyStatusListeners();
            return;
          }
          
          this.handleMessage(message);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.updateStatus('error');
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.stopPing();
        this.updateStatus('disconnected');
        this.attemptReconnect();
      };
    } catch (err) {
      console.error('Failed to connect WebSocket:', err);
      this.updateStatus('error');
      this.attemptReconnect();
    }
  }

  private handleMessage(message: unknown) {
    console.log('Received WebSocket message:', message);
    // TODO: Implement message handling
  }

  private startPing() {
    this.stopPing();
    this.pingInterval = window.setInterval(() => {
      this.sendPing();
    }, 10000); // Ping every 10 seconds
    
    // Send initial ping
    this.sendPing();
  }

  private stopPing() {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private sendPing() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.pingStats.lastPing = Date.now();
      this.send({ type: 'ping' });
      this.notifyStatusListeners();
    }
  }

  private updateStatus(status: ConnectionStatus) {
    this.pingStats.status = status;
    if (status === 'disconnected' || status === 'error') {
      this.pingStats.lastPing = null;
      this.pingStats.lastPong = null;
      this.pingStats.latency = null;
    }
    this.notifyStatusListeners();
  }

  private notifyStatusListeners() {
    this.statusCallbacks.forEach(callback => callback({ ...this.pingStats }));
  }

  onStatusChange(callback: (stats: PingStats) => void) {
    this.statusCallbacks.add(callback);
    // Immediately call with current status
    callback({ ...this.pingStats });
    return () => this.statusCallbacks.delete(callback);
  }

  getStatus(): PingStats {
    return { ...this.pingStats };
  }

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        this.connect();
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      console.error('Max reconnect attempts reached');
    }
  }

  send(message: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('WebSocket is not connected');
    }
  }

  disconnect() {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Create singleton instance
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';
export const wsClient = new WebSocketClient(WS_URL);
