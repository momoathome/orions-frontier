import { Redis } from 'ioredis';

const redisUrl = process.env['REDIS_URL'];

if (!redisUrl) {
  throw new Error('REDIS_URL is not defined');
}

// Separate IORedis connection for BullMQ (requires maxRetriesPerRequest: null)
export const bullmqRedis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

bullmqRedis.on('error', (err: Error) => {
  console.error('BullMQ Redis Error', err);
});
