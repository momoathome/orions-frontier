import type { FastifyInstance } from 'fastify';
import { WebSocket, WebSocketServer } from 'ws';
import type { JwtPayload } from '@orions-frontier/shared';

type RealtimeApp = Pick<FastifyInstance, 'server' | 'jwt'>;

interface ClientMessage {
  type: string;
  payload?: Record<string, unknown>;
}

interface ServerMessage {
  type: string;
  payload?: unknown;
  timestamp: number;
}

// ponytail: process-local fan-out assumes one API instance; add a broker when horizontally scaling.
const clients = new Map<string, Set<WebSocket>>();

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

export function publishUserEvent(userId: string, type: string, payload: unknown = {}): void {
  const message = { type, payload, timestamp: Date.now() };
  for (const socket of clients.get(userId) ?? []) send(socket, message);
}

export function attachRealtimeServer(app: RealtimeApp): WebSocketServer {
  const server = new WebSocketServer({ server: app.server });

  server.on('connection', (socket) => {
    let userId: string | null = null;
    const authTimeout = setTimeout(() => socket.close(4401, 'Authentication timeout'), 10_000);

    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as ClientMessage;

        if (!userId) {
          const token = message.payload?.['token'];
          if (message.type !== 'authenticate' || typeof token !== 'string') {
            socket.close(4401, 'Unauthorized');
            return;
          }

          const user = app.jwt.verify<JwtPayload>(token);
          userId = user.userId;
          clearTimeout(authTimeout);
          const userClients = clients.get(userId) ?? new Set<WebSocket>();
          userClients.add(socket);
          clients.set(userId, userClients);
          send(socket, {
            type: 'authenticated',
            payload: { userId, role: user.role },
            timestamp: Date.now(),
          });
          return;
        }

        if (message.type === 'ping') {
          send(socket, { type: 'pong', timestamp: Date.now() });
        }
      } catch {
        if (!userId) socket.close(4401, 'Unauthorized');
      }
    });

    socket.on('close', () => {
      clearTimeout(authTimeout);
      if (!userId) return;
      const userClients = clients.get(userId);
      userClients?.delete(socket);
      if (userClients?.size === 0) clients.delete(userId);
    });
  });

  return server;
}
