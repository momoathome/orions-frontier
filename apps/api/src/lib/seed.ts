import bcrypt from 'bcrypt';
import { eq, or } from 'drizzle-orm';
import { getDb } from './db/index.js';
import {
  spacecraftDefinitions,
  spacecraftDefinitionCosts,
} from './db/schema/spacecraft-definitions.js';
import { buildingDefinitions } from './db/schema/building-definitions.js';
import { sectors } from './db/schema/sectors.js';
import { users } from './db/schema/users.js';
import { stations } from './db/schema/stations.js';
import { spacecrafts, buildings } from '@orions-frontier/game-config';
import { sql } from 'drizzle-orm';
import { WORLD_CONFIG } from './world-config.js';
import { logger } from './logger.js';
import { createStation } from '../services/station.service.js';
import { ensureSector } from '../services/sector.service.js';

// ============================================================================
// Seed all static game data from game-config into the database (idempotent).
// Called once at startup. Changes when game-config schema or DB schema changes.
// ============================================================================

export const seedSpacecraftDefinitions = async (): Promise<void> => {
  const db = getDb();

  await db.transaction(async (tx) => {
    for (const def of spacecrafts) {
      const [upserted] = await tx
        .insert(spacecraftDefinitions)
        .values({
          key: def.key,
          name: def.name,
          description: def.description,
          role: def.role,
          image: def.image,
          attack: def.attack,
          defense: def.defense,
          cargo: def.cargo,
          speed: def.speed,
          miningRate: def.miningRate,
          buildTime: def.buildTime,
        })
        .onConflictDoUpdate({
          target: spacecraftDefinitions.key,
          set: {
            name: def.name,
            description: def.description,
            role: def.role,
            image: def.image,
            attack: def.attack,
            defense: def.defense,
            cargo: def.cargo,
            speed: def.speed,
            miningRate: def.miningRate,
            buildTime: def.buildTime,
          },
        })
        .returning({ id: spacecraftDefinitions.id, key: spacecraftDefinitions.key });

      if (!upserted) continue;

      // Replace costs while the upsert lock serializes concurrent startup/test seeds.
      await tx
        .delete(spacecraftDefinitionCosts)
        .where(eq(spacecraftDefinitionCosts.spacecraftDefinitionId, upserted.id));
      if (def.costs.length > 0) {
        await tx.insert(spacecraftDefinitionCosts).values(
          def.costs.map((cost) => ({
            spacecraftDefinitionId: upserted.id,
            resourceKey: cost.resourceKey,
            amount: cost.amount,
          }))
        );
      }
    }
  });
};

export const seedBuildingDefinitions = async (): Promise<void> => {
  const db = getDb();

  for (const def of buildings) {
    await db
      .insert(buildingDefinitions)
      .values({
        key: def.key,
        name: def.name,
        description: def.description,
        image: def.image,
        baseBuildTime: def.baseBuildTime,
        maxLevel: def.maxLevel,
        effectType: def.effectType,
      })
      .onConflictDoUpdate({
        target: buildingDefinitions.key,
        set: {
          name: def.name,
          description: def.description,
          image: def.image,
          baseBuildTime: def.baseBuildTime,
          maxLevel: def.maxLevel,
          effectType: def.effectType,
        },
      });
  }
};

export const seedAsteroidWorld = async (): Promise<void> => {
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
          sectorX === 0 && sectorY === 0 ? 'settlement' : 'frontier'
        );
      }
    }
  });
  logger.info({ radius, sectors: (radius * 2 + 1) ** 2 }, 'Initial world generated');
};

// ============================================================================
// seedDevUser
// Creates a developer user with a fully equipped station for local testing.
// Idempotent: skips if the dev user email already exists.
//
// Credentials:  dev@orion.local / dev123
// ============================================================================

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
