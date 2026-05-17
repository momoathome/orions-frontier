import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as schema from './schema/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Runs all pending database migrations.
 * Safe to call multiple times (idempotent via drizzle's journal).
 */
export const runMigrations = async (): Promise<void> => {
  const connectionString = process.env['DATABASE_URL'];

  if (!connectionString) {
    throw new Error('DATABASE_URL is not defined');
  }

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: join(__dirname, 'migrations') });

  await client.end();
};

// ── Standalone script mode (pnpm db:migrate) ─────────────────────────────────
const isMain = process.argv[1] === __filename;
if (isMain) {
  console.log('🔄 Running migrations...');
  runMigrations()
    .then(() => {
      console.log('✅ Migrations completed');
    })
    .catch((err) => {
      console.error('❌ Migration failed');
      console.error(err);
      process.exit(1);
    });
}
