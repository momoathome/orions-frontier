import bcrypt from 'bcrypt';
import { eq, or } from 'drizzle-orm';
import { getDb } from './db/index.js';
import {
  spacecraftDefinitions,
  spacecraftDefinitionCosts,
} from './db/schema/spacecraft-definitions.js';
import { buildingDefinitions } from './db/schema/building-definitions.js';
import { asteroids, asteroidVeins } from './db/schema/asteroids.js';
import { spawnSlots } from './db/schema/spawn-slots.js';
import { sectors } from './db/schema/sectors.js';
import { users } from './db/schema/users.js';
import { stations } from './db/schema/stations.js';
import { stationBuildings } from './db/schema/station-buildings.js';
import { stationSpacecrafts } from './db/schema/station-spacecrafts.js';
import { stationResources } from './db/schema/station-resources.js';
import { spacecrafts, buildings } from '@orions-frontier/game-config';
import { seedStationSpacecrafts } from '../services/spacecraft.service.js';
import { generateSector } from './world-gen/sector-gen.js';
import { resourceKeys } from '@orions-frontier/shared';
import { sql } from 'drizzle-orm';
import { WORLD_CONFIG } from './world-config.js';
import { logger } from './logger.js';

// ============================================================================
// Seed all static game data from game-config into the database (idempotent).
// Called once at startup. Changes when game-config schema or DB schema changes.
// ============================================================================

export const seedSpacecraftDefinitions = async (): Promise<void> => {
  const db = getDb();

  for (const def of spacecrafts) {
    const [upserted] = await db
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

    // Replace costs entirely so removed/changed costs are cleaned up.
    await db
      .delete(spacecraftDefinitionCosts)
      .where(eq(spacecraftDefinitionCosts.spacecraftDefinitionId, upserted.id));
    if (def.costs.length > 0) {
      await db.insert(spacecraftDefinitionCosts).values(
        def.costs.map((cost) => ({
          spacecraftDefinitionId: upserted.id,
          resourceKey: cost.resourceKey,
          amount: cost.amount,
        }))
      );
    }
  }
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

// ============================================================================
// Asteroid world seeder
// Seeds the full asteroid world procedurally using the sector-based generator.
// Idempotent: skips if the initial sector already exists.
// If asteroids exist but have no veins (stale migration state), clears and reseeds.
//
// Initial world: sector (0,0), centred at world origin.
// ============================================================================

const ASTEROID_BATCH_SIZE = 500;

export const seedAsteroidWorld = async (): Promise<void> => {
  const db = getDb();

  // Sector metadata remains after its last asteroid is exhausted. It therefore
  // distinguishes a mined-out persistent world from a database not seeded yet.
  const [sectorCount] = await db.select({ count: sql<number>`count(*)::int` }).from(sectors);
  if ((sectorCount?.count ?? 0) > 0) return;

  // Keep worlds created before sector metadata was introduced.
  const [veinCount] = await db.select({ count: sql<number>`count(*)::int` }).from(asteroidVeins);
  if ((veinCount?.count ?? 0) > 0) return;

  // Clear stale asteroids (no veins = invalid state from migration)
  await db.delete(asteroids);
  await db.delete(sectors);

  // Generate sector (0,0) — the starting sector
  const sector = generateSector(0, 0, WORLD_CONFIG.WORLD_SEED);
  const { asteroids: generatedAsteroids } = sector;

  logger.info(
    {
      archetype: sector.archetypeId,
      asteroids: generatedAsteroids.length,
      spawnSlots: sector.spawnSlots.length,
    },
    'World generated'
  );

  if (generatedAsteroids.length === 0) return;

  // Persist sector metadata first
  const [insertedSector] = await db
    .insert(sectors)
    .values({
      sectorX: sector.sectorX,
      sectorY: sector.sectorY,
      archetypeId: sector.archetypeId,
      seed: sector.seed,
    })
    .returning({ id: sectors.id });

  const sectorId = insertedSector!.id;

  // Batch-insert asteroids and collect IDs
  const allInsertedAsteroids: { id: string }[] = [];

  for (let i = 0; i < generatedAsteroids.length; i += ASTEROID_BATCH_SIZE) {
    const batch = generatedAsteroids.slice(i, i + ASTEROID_BATCH_SIZE);
    const inserted = await db
      .insert(asteroids)
      .values(
        batch.map((a) => ({
          x: a.x,
          y: a.y,
          chunkX: a.chunkX,
          chunkY: a.chunkY,
          size: a.size,
          hiddenLevel: a.hiddenLevel,
          sectorId,
        }))
      )
      .returning({ id: asteroids.id });

    allInsertedAsteroids.push(...inserted);
  }

  // Build vein inserts
  const veinValues: {
    asteroidId: string;
    veinType: string;
    resourceKey: string;
    remainingAmount: number;
  }[] = [];

  for (let i = 0; i < allInsertedAsteroids.length; i++) {
    const asteroidId = allInsertedAsteroids[i]!.id;
    const generated = generatedAsteroids[i]!;

    for (const vein of generated.veins) {
      veinValues.push({
        asteroidId,
        veinType: vein.veinType,
        resourceKey: vein.resourceKey,
        remainingAmount: vein.remainingAmount,
      });
    }
  }

  // Batch-insert veins
  for (let i = 0; i < veinValues.length; i += ASTEROID_BATCH_SIZE) {
    await db.insert(asteroidVeins).values(veinValues.slice(i, i + ASTEROID_BATCH_SIZE));
  }
};

// ============================================================================
// seedSpawnSlots
// Generates and stores the deterministic spawn slot positions for sector (0,0).
// Idempotent: skips if slots already exist.
// Must be called before seedDevUser and before any station is created.
// ============================================================================

export const seedSpawnSlots = async (): Promise<void> => {
  const db = getDb();

  const [slotCount] = await db.select({ count: sql<number>`count(*)::int` }).from(spawnSlots);
  if ((slotCount?.count ?? 0) > 0) return;

  // Resolve sector (0,0) so we can set the FK
  const [sector0] = await db
    .select({ id: sectors.id })
    .from(sectors)
    .where(eq(sectors.sectorX, 0))
    .limit(1);

  // sector (0,0) may not exist yet if seedAsteroidWorld hasn't run;
  // generate the slot positions deterministically regardless.
  const { spawnSlots: generatedSlots } = generateSector(0, 0, WORLD_CONFIG.WORLD_SEED);

  await db.insert(spawnSlots).values(
    generatedSlots.map((s) => ({
      slotIndex: s.slotIndex,
      x: s.x,
      y: s.y,
      sectorId: sector0?.id ?? null,
    }))
  );
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
const DEV_RESOURCE_AMOUNT = 200;

export const seedDevUser = async (): Promise<void> => {
  const db = getDb();

  // Check if dev user exists
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

  // Check if station already exists for this user
  const existingStation = await db
    .select({ id: stations.id })
    .from(stations)
    .where(eq(stations.userId, devUserId))
    .limit(1);

  let devStationId: string;

  if (existingStation.length > 0) {
    // Station exists — check if it's fully equipped and fill in any missing parts
    devStationId = existingStation[0]!.id;

    const [existingResources, existingBuildings, existingSpacecrafts] = await Promise.all([
      db
        .select({ id: stationResources.resourceKey })
        .from(stationResources)
        .where(eq(stationResources.stationId, devStationId))
        .limit(1),
      db
        .select({ id: stationBuildings.id })
        .from(stationBuildings)
        .where(eq(stationBuildings.stationId, devStationId))
        .limit(1),
      db
        .select({ id: stationSpacecrafts.id })
        .from(stationSpacecrafts)
        .where(eq(stationSpacecrafts.stationId, devStationId))
        .limit(1),
    ]);

    if (existingResources.length === 0) {
      await db.insert(stationResources).values(
        resourceKeys.map((key) => ({
          stationId: devStationId,
          resourceKey: key,
          amount: DEV_RESOURCE_AMOUNT,
        }))
      );
    }

    if (existingBuildings.length === 0) {
      const allBuildings = await db
        .select({ id: buildingDefinitions.id })
        .from(buildingDefinitions);
      if (allBuildings.length > 0) {
        await db.insert(stationBuildings).values(
          allBuildings.map((b) => ({
            stationId: devStationId,
            buildingDefinitionId: b.id,
            level: 1,
          }))
        );
      }
    }

    if (existingSpacecrafts.length === 0) {
      await seedStationSpacecrafts(devStationId);
    }

    return;
  }

  // 2. Create station at spawn slot 0
  const [slot0] = await db.select().from(spawnSlots).where(eq(spawnSlots.slotIndex, 0)).limit(1);

  if (!slot0) throw new Error('Spawn slot 0 not found — run seedSpawnSlots first');

  const [devStation] = await db
    .insert(stations)
    .values({
      userId: devUserId,
      name: 'Dev Station Alpha',
      x: slot0.x,
      y: slot0.y,
    })
    .returning({ id: stations.id });

  if (!devStation) throw new Error('Failed to create dev station');

  devStationId = devStation.id;

  // Mark slot 0 as claimed
  await db.update(spawnSlots).set({ stationId: devStationId }).where(eq(spawnSlots.id, slot0.id));

  // 3. Seed resources
  await db.insert(stationResources).values(
    resourceKeys.map((key) => ({
      stationId: devStationId,
      resourceKey: key,
      amount: DEV_RESOURCE_AMOUNT,
    }))
  );

  // 4. Assign all building definitions at level 1
  const allBuildings = await db.select({ id: buildingDefinitions.id }).from(buildingDefinitions);

  if (allBuildings.length > 0) {
    await db.insert(stationBuildings).values(
      allBuildings.map((b) => ({
        stationId: devStationId,
        buildingDefinitionId: b.id,
        level: 1,
      }))
    );
  }

  // 5. Assign initial spacecrafts (1 Mole, 10 Nomads)
  await seedStationSpacecrafts(devStationId);
};
