import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { getDb } from './lib/db/index.js';
import { sectors } from './lib/db/schema/sectors.js';
import { users } from './lib/db/schema/users.js';
import { stations } from './lib/db/schema/stations.js';
import { sql } from 'drizzle-orm';
import { WORLD_CONFIG } from './lib/world-config.js';
import { logger } from './lib/logger.js';
import { createStation } from './services/station/index.js';
import { ensureSector } from './services/map/index.js';
import {
  createRealtimeExecutionContext,
  type GameExecutionContext,
} from './lib/game-execution-context.js';

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

// seedAdminUser
// Creates the admin account with a station. Idempotent: on later starts it only applies the
// configured email and password, so changing them in .env takes effect on the next start.
export const seedAdminUser = async (email: string, password: string): Promise<void> => {
  const db = getDb();
  const passwordHash = await bcrypt.hash(password, 10);

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'admin'))
    .orderBy(users.createdAt)
    .limit(1);

  let adminId: string;

  if (existing) {
    adminId = existing.id;
    await db.update(users).set({ email, passwordHash }).where(eq(users.id, adminId));
  } else {
    const [admin] = await db
      .insert(users)
      .values({ username: 'admin', email, passwordHash, role: 'admin', status: 'active' })
      .returning({ id: users.id });

    if (!admin) throw new Error('Failed to create admin user');
    adminId = admin.id;
  }

  const [existingStation] = await db
    .select({ id: stations.id })
    .from(stations)
    .where(eq(stations.userId, adminId))
    .limit(1);
  if (!existingStation) await createStation(adminId, { name: 'Admin Station' });
};
