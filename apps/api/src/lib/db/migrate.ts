import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { join } from 'path';
import * as schema from './schema/index.js';

/**
 * Runs all pending database migrations.
 * Safe to call multiple times (idempotent via drizzle's journal).
 */
export const runMigrations = async (): Promise<void> => {
  if (!process.env['DATABASE_URL']) {
    try {
      process.loadEnvFile(join(import.meta.dirname, '../../../../../.env'));
    } catch {
      // Docker injects the environment; a local .env file is optional.
    }
  }
  const connectionString = process.env['DATABASE_URL'];

  if (!connectionString) {
    throw new Error('DATABASE_URL is not defined');
  }

  // One connection, so the session lock and the migration share it.
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });
  try {
    // Processes starting together migrate one after another; the later ones find nothing to do.
    await client`SELECT pg_advisory_lock(hashtext('orions:migrations'))`;
    try {
      await migrate(db, { migrationsFolder: join(import.meta.dirname, 'migrations') });
    } finally {
      await client`SELECT pg_advisory_unlock(hashtext('orions:migrations'))`;
    }
  } finally {
    await client.end();
  }
};

if (import.meta.main) {
  console.log('🔄 Running migrations...');
  runMigrations()
    .then(() => {
      console.log('✅ Migrations completed');
    })
    .catch((error: unknown) => {
      console.error('❌ Migration failed');
      console.error(error);
      process.exit(1);
    });
}
