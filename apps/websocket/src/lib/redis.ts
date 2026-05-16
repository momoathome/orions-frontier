import { Redis } from 'ioredis';

const redisUrl = process.env['REDIS_URL'];

if (!redisUrl) {
  throw new Error('REDIS_URL is not defined');
}

export const createSubscriber = (): Redis =>
  new Redis(redisUrl, { maxRetriesPerRequest: null });
