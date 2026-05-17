import bcrypt from 'bcrypt';
import { eq, or } from 'drizzle-orm';
import { getDb } from './db/index.js';
import { spacecraftDefinitions, spacecraftDefinitionCosts } from './db/schema/spacecraft-definitions.js';
import { buildingDefinitions } from './db/schema/building-definitions.js';
import { asteroids, asteroidVeins, asteroidResourceStorage } from './db/schema/asteroids.js';
import { users } from './db/schema/users.js';
import { stations } from './db/schema/stations.js';
import { stationBuildings } from './db/schema/station-buildings.js';
import { stationSpacecrafts } from './db/schema/station-spacecrafts.js';
import { stationResources } from './db/schema/station-resources.js';
import { spacecrafts, buildings } from '@orions-frontier/game-config';
import { generateWorld } from './world-gen.js';
import { resourceKeys } from '@orions-frontier/shared';
import { sql } from 'drizzle-orm';
import { WORLD_CONFIG } from './world-config.js';

// ============================================================================
// Seed all static game data from game-config into the database (idempotent).
// Called once at startup. Changes when game-config schema or DB schema changes.
// ============================================================================

export const seedSpacecraftDefinitions = async (): Promise<void> => {
  const db = getDb();

  for (const def of spacecrafts) {
    const [inserted] = await db
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
      .onConflictDoNothing({ target: spacecraftDefinitions.key })
      .returning({ id: spacecraftDefinitions.id, key: spacecraftDefinitions.key });

    if (!inserted) continue;

    if (def.costs.length > 0) {
      await db.insert(spacecraftDefinitionCosts).values(
        def.costs.map((cost) => ({
          spacecraftDefinitionId: inserted.id,
          resourceKey: cost.resourceKey,
          amount: cost.amount,
        })),
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
      .onConflictDoNothing({ target: buildingDefinitions.key });
  }
};

// ============================================================================
// Asteroid world seeder
// Seeds the full asteroid world procedurally using the zone-based generator.
// Idempotent: skips if asteroid_veins are already populated.
// If asteroids exist but have no veins (stale migration state), clears and reseeds.
// ============================================================================

/**
 * Player count used for world generation.
 * Adjust to match your expected concurrent player + AI count.
 * Higher count → larger world radius.
 */
const WORLD_PLAYER_COUNT = 8;

const ASTEROID_BATCH_SIZE = 500;

export const seedAsteroidWorld = async (): Promise<void> => {
  const db = getDb();

  // Idempotency: skip if veins are already populated
  const [veinCount] = await db.select({ count: sql<number>`count(*)::int` }).from(asteroidVeins);

  if ((veinCount?.count ?? 0) > 0) return;

  // Clear stale asteroids (no veins = invalid state from migration)
  await db.delete(asteroids);

  // Generate world
  const { generatedAsteroids } = generateWorld(WORLD_PLAYER_COUNT, WORLD_CONFIG.WORLD_SEED);

  if (generatedAsteroids.length === 0) return;

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
          stability: a.stability,
          hiddenLevel: a.hiddenLevel,
          clusterId: null,
        }))
      )
      .returning({ id: asteroids.id });

    allInsertedAsteroids.push(...inserted);
  }

  // Build vein + storage inserts
  const veinValues: {
    asteroidId: string;
    veinType: string;
    resourceKey: string;
    yieldPerHour: number;
    purity: number;
    purityTier: string;
  }[] = [];

  const storageValues: { asteroidId: string; resourceKey: string; amount: number }[] = [];
  const seenStorage = new Set<string>();

  for (let i = 0; i < allInsertedAsteroids.length; i++) {
    const asteroidId = allInsertedAsteroids[i]!.id;
    const generated = generatedAsteroids[i]!;

    for (const vein of generated.veins) {
      veinValues.push({
        asteroidId,
        veinType: vein.veinType,
        resourceKey: vein.resourceKey,
        yieldPerHour: vein.yieldPerHour,
        purity: vein.purity,
        purityTier: vein.purityTier,
      });

      const storageKey = `${asteroidId}:${vein.resourceKey}`;
      if (!seenStorage.has(storageKey)) {
        seenStorage.add(storageKey);
        storageValues.push({ asteroidId, resourceKey: vein.resourceKey, amount: 0 });
      }
    }
  }

  // Batch-insert veins
  for (let i = 0; i < veinValues.length; i += ASTEROID_BATCH_SIZE) {
    await db.insert(asteroidVeins).values(veinValues.slice(i, i + ASTEROID_BATCH_SIZE));
  }

  // Batch-insert storage
  for (let i = 0; i < storageValues.length; i += ASTEROID_BATCH_SIZE) {
    await db
      .insert(asteroidResourceStorage)
      .values(storageValues.slice(i, i + ASTEROID_BATCH_SIZE));
  }
};;

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

  // Skip if dev user already exists (check both email and username)
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.email, DEV_EMAIL), eq(users.username, 'dev')))
    .limit(1);

  if (existing.length > 0) return;

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

  // 2. Create station
  const [devStation] = await db
    .insert(stations)
    .values({
      userId: devUser.id,
      name: 'Dev Station Alpha',
      x: 0,
      y: 0,
    })
    .returning({ id: stations.id });

  if (!devStation) throw new Error('Failed to create dev station');

  // 3. Seed resources (generous amounts for testing)
  await db.insert(stationResources).values(
    resourceKeys.map((key) => ({
      stationId: devStation.id,
      resourceKey: key,
      amount: 50_000,
    })),
  );

  // 4. Assign all building definitions at level 1
  const allBuildings = await db
    .select({ id: buildingDefinitions.id })
    .from(buildingDefinitions);

  if (allBuildings.length > 0) {
    await db.insert(stationBuildings).values(
      allBuildings.map((b) => ({
        stationId: devStation.id,
        buildingDefinitionId: b.id,
        level: 1,
      })),
    );
  }

  // 5. Assign all spacecraft definitions with 5 units each
  const allSpacecraftDefs = await db
    .select({ id: spacecraftDefinitions.id })
    .from(spacecraftDefinitions);

  if (allSpacecraftDefs.length > 0) {
    await db.insert(stationSpacecrafts).values(
      allSpacecraftDefs.map((s) => ({
        stationId: devStation.id,
        spacecraftDefinitionId: s.id,
        amount: 5,
        lockedAmount: 0,
      })),
    );
  }
};
