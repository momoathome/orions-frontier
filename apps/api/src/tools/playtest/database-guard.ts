import postgres from 'postgres';

export const PLAYTEST_DATABASE_HOST = 'playtest-postgres';
export const PLAYTEST_DATABASE_NAME = 'orions_frontier_playtest';

type PlaytestEnvironment = Record<string, string | undefined>;

function guardedError(message: string): Error {
  return new Error(`Playtest database guard rejected the target: ${message}`);
}

export function assertPlaytestDatabaseTarget(environment: PlaytestEnvironment = process.env): URL {
  if (environment['PLAYTEST_MODE'] !== '1') {
    throw guardedError('PLAYTEST_MODE must equal 1');
  }
  const connectionString = environment['DATABASE_URL'];
  if (!connectionString) throw guardedError('DATABASE_URL is missing');

  let target: URL;
  try {
    target = new URL(connectionString);
  } catch {
    throw guardedError('DATABASE_URL is invalid');
  }
  if (target.protocol !== 'postgresql:' && target.protocol !== 'postgres:') {
    throw guardedError('only PostgreSQL URLs are allowed');
  }

  const expectedHost = environment['PLAYTEST_EXPECTED_HOST'] ?? PLAYTEST_DATABASE_HOST;
  const expectedDatabase = environment['PLAYTEST_EXPECTED_DATABASE'] ?? PLAYTEST_DATABASE_NAME;
  const database = decodeURIComponent(target.pathname.replace(/^\/+/, ''));
  if (target.hostname !== expectedHost || expectedHost !== PLAYTEST_DATABASE_HOST) {
    throw guardedError(`host must be ${PLAYTEST_DATABASE_HOST}`);
  }
  if (database !== expectedDatabase || expectedDatabase !== PLAYTEST_DATABASE_NAME) {
    throw guardedError(`database must be ${PLAYTEST_DATABASE_NAME}`);
  }
  if (target.port !== '' && target.port !== '5432') {
    throw guardedError('port must be PostgreSQL port 5432');
  }
  return target;
}

export async function assertPlaytestDatabaseEmpty(target: URL): Promise<void> {
  const client = postgres(target.toString(), {
    max: 1,
    connect_timeout: 10,
  });
  try {
    const tables = await client<{ tableName: string }[]>`
      select table_name as "tableName"
      from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
        and table_name <> '__drizzle_migrations'
      order by table_name
    `;
    for (const { tableName } of tables) {
      const [result] = await client<{ hasRows: boolean }[]>`
        select exists(select 1 from ${client(tableName)} limit 1) as "hasRows"
      `;
      if (result?.hasRows) {
        throw guardedError(`game table ${tableName} is not empty`);
      }
    }
  } finally {
    await client.end();
  }
}

export async function guardPlaytestDatabase(
  environment: PlaytestEnvironment = process.env
): Promise<URL> {
  const target = assertPlaytestDatabaseTarget(environment);
  await assertPlaytestDatabaseEmpty(target);
  return target;
}
