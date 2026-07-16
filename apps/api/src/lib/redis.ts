import { Redis } from 'ioredis';

let redisClient: Redis | null = null;

export const initRedis = async (): Promise<Redis> => {
  const redisUrl = process.env['REDIS_URL'];

  if (!redisUrl) {
    throw new Error('REDIS_URL is not defined');
  }

  redisClient = new Redis(redisUrl);

  redisClient.on('error', (err) => {
    console.error('Redis Client Error', err);
  });

  await redisClient.ping();

  return redisClient;
};

export const getRedis = (): Redis => {
  if (!redisClient) {
    throw new Error('Redis not initialized. Call initRedis() first.');
  }
  return redisClient;
};

export const closeRedis = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.quit();
  }
};
