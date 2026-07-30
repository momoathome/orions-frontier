import bcrypt from 'bcrypt';
import { eq, or } from 'drizzle-orm';
import { getDb } from './db/index.js';
import { sectors } from './db/schema/sectors.js';
import { users } from './db/schema/users.js';
import { stations } from './db/schema/stations.js';
import { sql } from 'drizzle-orm';
import { WORLD_CONFIG } from './world-config.js';
import { logger } from './logger.js';
import { createStation } from '../services/station.service.js';
import { ensureSector } from '../services/sector.service.js';
import {
  createRealtimeExecutionContext,
  type GameExecutionContext,
} from './game-execution-context.js';

export const seedAsteroidWorld = async (
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> => {
  const db = getDb();
  const [sectorCount] = await db.select({ count: sql<number>`count(*)::int` }).from(sectors);
  if ((sectorCount?.count ?? 0) > 0) return;
  const radius = WORLD_CONFIG.INITIAL_SECTOR_RADIUS;
  await db.transaction(async (tx) => {
    for (let sectorY = -radius; sectorY <= radius; sectorY += 1) {
      for (let sectorX = -radius; sectorX <= radius; sectorX += 1) {
        await ensureSector(
          tx,
          sectorX,
          sectorY,
          sectorX === 0 && sectorY === 0 ? 'settlement' : 'frontier',
          context
        );
      }
    }
  });
  logger.info({ radius, sectors: (radius * 2 + 1) ** 2 }, 'Initial world generated');
};

// seedDevUser
// Creates a developer user with a fully equipped station for local testing.
// Idempotent: skips if the dev user email already exists.
//
// Credentials:  dev@orion.local / dev123

const DEV_EMAIL = 'dev@orion.local';
const DEV_PASSWORD = 'dev123';
export const seedDevUser = async (): Promise<void> => {
  const db = getDb();

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.email, DEV_EMAIL), eq(users.username, 'dev')))
    .limit(1);

  let devUserId: string;

  if (existing.length > 0) {
    devUserId = existing[0]!.id;
  } else {
    // 1. Create user
    const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);
    const [devUser] = await db
      .insert(users)
      .values({
        username: 'dev',
        email: DEV_EMAIL,
        passwordHash,
        role: 'admin',
        status: 'active',
      })
      .returning({ id: users.id });

    if (!devUser) throw new Error('Failed to create dev user');
    devUserId = devUser.id;
  }

  const [existingStation] = await db
    .select({ id: stations.id })
    .from(stations)
    .where(eq(stations.userId, devUserId))
    .limit(1);
  if (!existingStation) await createStation(devUserId, { name: 'Dev Station Alpha' });
};
