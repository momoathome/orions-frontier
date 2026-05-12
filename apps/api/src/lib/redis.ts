import { createClient } from 'redis';

let redisClient: ReturnType<typeof createClient> | null = null;

export const initRedis = async () => {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error('REDIS_URL is not defined');
  }

  redisClient = createClient({
    url: redisUrl,
  });

  redisClient.on('error', (err) => {
    console.error('Redis Client Error', err);
  });

  await redisClient.connect();

  return redisClient;
};

export const getRedis = () => {
  if (!redisClient) {
    throw new Error('Redis not initialized. Call initRedis() first.');
  }
  return redisClient;
};

export const closeRedis = async () => {
  if (redisClient) {
    await redisClient.quit();
  }
};
