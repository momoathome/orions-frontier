import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { handleConnection } from './handlers/connection.js';
import { logger } from './lib/logger.js';
import { createSubscriber } from './lib/redis.js';
import { getClients } from './lib/client-registry.js';

const start = async () => {
  const port = Number(process.env['WS_PORT']) || 3001;
  const host = process.env['WS_HOST'] || '0.0.0.0';

  const server = createServer();
  const wss = new WebSocketServer({ server });

  wss.on('connection', handleConnection);

  wss.on('error', (error) => {
    logger.error('WebSocket Server Error:', error);
  });

  // Redis Pub/Sub — receive events from API worker and push to connected clients
  const subscriber = createSubscriber();

  subscriber.on('error', (err) => logger.error('Redis subscriber error:', err));

  await subscriber.psubscribe('user:*:events');

  subscriber.on('pmessage', (_pattern, channel, message) => {
    const userId = channel.split(':')[1];
    if (!userId) return;

    try {
      const event = JSON.parse(message) as { type: string; payload?: unknown; timestamp: number };
      for (const ws of getClients(userId)) {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(event));
        }
      }
    } catch (err) {
      logger.error('Failed to dispatch Redis event to WebSocket client:', err);
    }
  });

  logger.info('Redis subscriber started — listening on user:*:events');

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
