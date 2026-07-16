import type { WebSocket } from 'ws';
import type { JwtPayload } from '@orions-frontier/shared';
import jwt from 'jsonwebtoken';
import { logger } from '../lib/logger.js';
import { registerClient, unregisterClient } from '../lib/client-registry.js';

const AUTH_TIMEOUT_MS = 10_000; // 10 seconds to send authenticate message
const PING_INTERVAL_MS = 30_000;

interface WsMessage {
  type: string;
  payload?: Record<string, unknown>;
  timestamp: number;
}

interface AuthenticatedWebSocket extends WebSocket {
  isAlive: boolean;
  user: JwtPayload;
}

export const handleConnection = (ws: WebSocket) => {
  let authenticated = false;
  let authTimeout: ReturnType<typeof setTimeout> | null = null;

  // Give client a window to authenticate
  authTimeout = setTimeout(() => {
    if (!authenticated) {
      logger.warn('WebSocket client did not authenticate in time, closing');
      sendError(ws, 'Authentication timeout');
      ws.close(4401, 'Authentication timeout');
    }
  }, AUTH_TIMEOUT_MS);

  ws.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString()) as WsMessage;

      if (!authenticated) {
        if (message.type !== 'authenticate') {
          sendError(
            ws,
            'Not authenticated. Send { type: "authenticate", payload: { token }, timestamp } first.'
          );
          return;
        }
        handleAuthenticate(ws as AuthenticatedWebSocket, message, () => {
          authenticated = true;
          if (authTimeout) {
            clearTimeout(authTimeout);
            authTimeout = null;
          }
          setupAuthenticatedConnection(ws as AuthenticatedWebSocket);
        });
        return;
      }

      handleMessage(ws as AuthenticatedWebSocket, message);
    } catch (error) {
      logger.error('Failed to parse WebSocket message:', error);
      sendError(ws, 'Invalid message format');
    }
  });

  ws.on('error', (error) => {
    logger.error('WebSocket error:', error);
    if (authTimeout) clearTimeout(authTimeout);
  });

  ws.on('close', () => {
    if (authTimeout) clearTimeout(authTimeout);
    logger.info('WebSocket connection closed');
  });
};

const handleAuthenticate = (
  ws: AuthenticatedWebSocket,
  message: WsMessage,
  onSuccess: () => void
) => {
  const secret = process.env['JWT_SECRET'];
  if (!secret) {
    logger.error('JWT_SECRET is not configured on WebSocket server');
    ws.close(1011, 'Server configuration error');
    return;
  }

  const token = message.payload?.['token'];
  if (typeof token !== 'string' || !token) {
    sendError(ws, 'Missing token in authenticate payload');
    ws.close(4401, 'Unauthorized');
    return;
  }

  try {
    const payload = jwt.verify(token, secret) as JwtPayload;
    ws.user = payload;
    onSuccess();
  } catch {
    logger.warn('Invalid JWT token on WebSocket connection');
    sendError(ws, 'Invalid or expired token');
    ws.close(4401, 'Unauthorized');
  }
};

const setupAuthenticatedConnection = (ws: AuthenticatedWebSocket) => {
  ws.isAlive = true;

  logger.info(`WebSocket authenticated: userId=${ws.user.userId}`);

  registerClient(ws.user.userId, ws);

  send(ws, {
    type: 'authenticated',
    timestamp: Date.now(),
    payload: { userId: ws.user.userId, role: ws.user.role },
  });

  const pingInterval = setInterval(() => {
    if (ws.isAlive === false) {
      logger.warn(`Client ${ws.user.userId} did not respond to ping, terminating`);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  }, PING_INTERVAL_MS);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('close', () => {
    logger.info(`WebSocket closed: userId=${ws.user.userId}`);
    clearInterval(pingInterval);
    unregisterClient(ws.user.userId, ws);
  });
};

const handleMessage = (ws: AuthenticatedWebSocket, message: WsMessage) => {
  logger.debug(`Message from userId=${ws.user.userId}:`, message.type);

  switch (message.type) {
    case 'ping':
      send(ws, { type: 'pong', timestamp: Date.now() });
      break;
    default:
      logger.warn('Unknown message type:', message.type);
      sendError(ws, `Unknown message type: ${message.type}`);
  }
};

const send = (ws: WebSocket, message: WsMessage) => {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
};

const sendError = (ws: WebSocket, errorMessage: string) => {
  send(ws, {
    type: 'error',
    timestamp: Date.now(),
    payload: { message: errorMessage },
  });
};
