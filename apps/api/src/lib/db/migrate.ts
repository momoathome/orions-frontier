import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

const runMigration = async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not defined');
  }

  console.log('🔄 Running migrations...');

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: './src/lib/db/migrations' });

  await client.end();

  console.log('✅ Migrations completed');
};

runMigration().catch((err) => {
  console.error('❌ Migration failed');
  console.error(err);
  process.exit(1);
});
