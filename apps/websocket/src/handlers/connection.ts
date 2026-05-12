import type { WebSocket } from 'ws';
import type { WsMessage } from '@orions-frontier/types';
import { APP_CONSTANTS } from '@orions-frontier/shared';
import { logger } from '../lib/logger.js';

interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  userId?: string;
}

export const handleConnection = (ws: WebSocket) => {
  const extWs = ws as ExtendedWebSocket;
  extWs.isAlive = true;

  logger.info('New WebSocket connection established');

  // Ping/Pong for connection health
  const pingInterval = setInterval(() => {
    if (extWs.isAlive === false) {
      logger.warn('Client did not respond to ping, terminating connection');
      return extWs.terminate();
    }

    extWs.isAlive = false;
    extWs.ping();
  }, APP_CONSTANTS.WS_PING_INTERVAL_MS);

  extWs.on('pong', () => {
    extWs.isAlive = true;
  });

  // Handle incoming messages
  extWs.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString()) as WsMessage;
      handleMessage(extWs, message);
    } catch (error) {
      logger.error('Failed to parse WebSocket message:', error);
      sendError(extWs, 'Invalid message format');
    }
  });

  // Handle errors
  extWs.on('error', (error) => {
    logger.error('WebSocket error:', error);
  });

  // Handle disconnect
  extWs.on('close', () => {
    logger.info('WebSocket connection closed');
    clearInterval(pingInterval);
  });

  // Send connection confirmation
  send(extWs, {
    type: 'connection',
    timestamp: Date.now(),
    payload: {
      message: 'Connected to Orions Frontier WebSocket server',
    },
  });
};

const handleMessage = (ws: ExtendedWebSocket, message: WsMessage) => {
  logger.debug('Received message:', message);

  switch (message.type) {
    case 'ping':
      send(ws, {
        type: 'pong',
        timestamp: Date.now(),
      });
      break;

    // Add more message handlers here in later phases
    default:
      logger.warn('Unknown message type:', message.type);
      sendError(ws, `Unknown message type: ${message.type}`);
  }
};

const send = (ws: ExtendedWebSocket, message: WsMessage) => {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
};

const sendError = (ws: ExtendedWebSocket, errorMessage: string) => {
  send(ws, {
    type: 'error',
    timestamp: Date.now(),
    payload: {
      message: errorMessage,
    },
  });
};
