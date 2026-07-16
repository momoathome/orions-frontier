import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

let db: ReturnType<typeof drizzle> | null = null;
let client: ReturnType<typeof postgres> | null = null;

export const initDb = async () => {
  const connectionString = process.env['DATABASE_URL'];

  if (!connectionString) {
    throw new Error('DATABASE_URL is not defined');
  }

  client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  db = drizzle(client, { schema });

  return db;
};

export const getDb = () => {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
};

export const closeDb = async (): Promise<void> => {
  await client?.end();
  client = null;
  db = null;
};
