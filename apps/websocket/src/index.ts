import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { handleConnection } from './handlers/connection.js';
import { logger } from './lib/logger.js';

const start = async () => {
  const port = Number(process.env.WS_PORT) || 3001;
  const host = process.env.WS_HOST || '0.0.0.0';

  const server = createServer();
  const wss = new WebSocketServer({ server });

  wss.on('connection', handleConnection);

  wss.on('error', (error) => {
    logger.error('WebSocket Server Error:', error);
  });

  server.listen(port, host, () => {
    logger.info(`🚀 WebSocket server is running on ws://${host}:${port}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM signal received: closing WebSocket server');
    wss.close(() => {
      logger.info('WebSocket server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT signal received: closing WebSocket server');
    wss.close(() => {
      logger.info('WebSocket server closed');
      process.exit(0);
    });
  });
};

start().catch((err) => {
  logger.error('Failed to start WebSocket server:', err);
  process.exit(1);
});
