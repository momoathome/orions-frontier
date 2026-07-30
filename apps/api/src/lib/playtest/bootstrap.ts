import { eq, sql } from 'drizzle-orm';
import type { GameExecutionContext } from '../game-execution-context.js';
import { getDb, initDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { stations } from '../db/schema/stations.js';
import { users } from '../db/schema/users.js';
import { seedAsteroidWorld } from '../seed.js';
import { guardPlaytestDatabase } from './database-guard.js';
import { calculatePlaytestWorldChecksum, type PlaytestWorldSummary } from './world-checksum.js';

export interface PlaytestBootstrapConfig {
  seed: string;
  virtualStart: Date;
}

export interface PlaytestBootstrapResult extends PlaytestWorldSummary {
  users: number;
  stations: number;
}

export async function bootstrapPlaytestWorld(
  config: PlaytestBootstrapConfig,
  context: GameExecutionContext
): Promise<PlaytestBootstrapResult> {
  if (config.seed !== context.worldSeed) {
    throw new Error('Playtest bootstrap seed and execution-context world seed must match');
  }
  if (config.virtualStart.getTime() !== context.now.getTime()) {
    throw new Error('Playtest bootstrap start and execution-context time must match');
  }

  // This must remain the first database operation: it refuses non-isolated or reused targets.
  await guardPlaytestDatabase();
  await runMigrations();
  await initDb();
  await seedAsteroidWorld(context);

  const db = getDb();
  const [world, userCount, stationCount, unexpectedDevUser] = await Promise.all([
    calculatePlaytestWorldChecksum(),
    db.select({ count: sql<number>`count(*)::int` }).from(users),
    db.select({ count: sql<number>`count(*)::int` }).from(stations),
    db.select({ id: users.id }).from(users).where(eq(users.email, 'dev@orion.local')).limit(1),
  ]);
  if (unexpectedDevUser.length > 0) throw new Error('Playtest bootstrap created a dev account');

  return {
    ...world,
    users: userCount[0]?.count ?? 0,
    stations: stationCount[0]?.count ?? 0,
  };
}
