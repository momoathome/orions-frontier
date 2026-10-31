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

/**
 * Runs `fn` only while this process holds the named session lock; undefined if another holds it.
 * A reserved connection, because a session lock belongs to the connection that took it.
 */
export const withExclusiveLock = async <T>(
  name: string,
  fn: () => Promise<T>
): Promise<T | undefined> => {
  if (!client) throw new Error('Database not initialized. Call initDb() first.');
  const connection = await client.reserve();
  try {
    const [row] = await connection<{ locked: boolean }[]>`
      select pg_try_advisory_lock(hashtext(${name})) as locked`;
    if (!row?.locked) return undefined;
    try {
      return await fn();
    } finally {
      await connection`select pg_advisory_unlock(hashtext(${name}))`;
    }
  } finally {
    connection.release();
  }
};

export type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];
/** A transaction or the pooled connection; for reads that work inside and outside a transaction. */
export type QueryDb = Tx | ReturnType<typeof getDb>;
