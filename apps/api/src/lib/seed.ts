import bcrypt from 'bcrypt';
import { eq, or } from 'drizzle-orm';
import { getDb } from './db/index.js';
import { spacecraftDefinitions, spacecraftDefinitionCosts } from './db/schema/spacecraft-definitions.js';
import { buildingDefinitions } from './db/schema/building-definitions.js';
import { asteroidClusters, asteroids } from './db/schema/asteroids.js';
import { users } from './db/schema/users.js';
import { stations } from './db/schema/stations.js';
import { stationBuildings } from './db/schema/station-buildings.js';
import { stationSpacecrafts } from './db/schema/station-spacecrafts.js';
import { stationResources } from './db/schema/station-resources.js';
import { spacecrafts, buildings } from '@orions-frontier/game-config';
import { worldToChunk, SeededRng, generateClusterPositions } from './world-gen.js';
import type { AsteroidResourceType } from '@orions-frontier/shared';
import { resourceKeys } from '@orions-frontier/shared';
import { sql } from 'drizzle-orm';

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
// Seeds clusters and asteroid instances for the initial world.
// Idempotent: skips if world data already exists.
// ============================================================================

interface ClusterSeedDef {
  name: string;
  centerX: number;
  centerY: number;
  radius: number;
  resourceBias: AsteroidResourceType;
  seed: string;
  /** Number of asteroids to spawn in this cluster */
  count: number;
  /** Fraction of asteroids using the bias resource (0–1) */
  biasFraction: number;
  /** Min hidden_level for asteroids in this cluster */
  hiddenMin: number;
  /** Max hidden_level for asteroids in this cluster */
  hiddenMax: number;
  /** Min richness */
  richnessMin: number;
  /** Max richness */
  richnessMax: number;
}

const ALL_RESOURCE_TYPES: AsteroidResourceType[] = [
  'carbon',
  'titanium',
  'hydrogenium',
  'kyber_crystal',
  'astatine',
];

const CLUSTER_DEFS: ClusterSeedDef[] = [
  {
    name: 'Carbon Belt',
    centerX: -1500,
    centerY: 2000,
    radius: 1200,
    resourceBias: 'carbon',
    seed: 'carbon-belt-alpha',
    count: 40,
    biasFraction: 0.75,
    hiddenMin: 0,
    hiddenMax: 0,
    richnessMin: 15,
    richnessMax: 65,
  },
  {
    name: 'Titanium Fields',
    centerX: 2000,
    centerY: 1500,
    radius: 800,
    resourceBias: 'titanium',
    seed: 'titanium-fields-beta',
    count: 30,
    biasFraction: 0.7,
    hiddenMin: 0,
    hiddenMax: 0,
    richnessMin: 20,
    richnessMax: 70,
  },
  {
    name: 'Hydrogenium Clouds',
    centerX: 3500,
    centerY: -1000,
    radius: 600,
    resourceBias: 'hydrogenium',
    seed: 'hydrogenium-clouds-gamma',
    count: 20,
    biasFraction: 0.65,
    hiddenMin: 0,
    hiddenMax: 1,
    richnessMin: 25,
    richnessMax: 75,
  },
  {
    name: 'Kyber Crystal Field',
    centerX: -2500,
    centerY: -2000,
    radius: 400,
    resourceBias: 'kyber_crystal',
    seed: 'kyber-crystal-field-delta',
    count: 15,
    biasFraction: 0.8,
    hiddenMin: 1,
    hiddenMax: 3,
    richnessMin: 40,
    richnessMax: 90,
  },
  {
    name: 'Astatine Deposits',
    centerX: 500,
    centerY: -3000,
    radius: 500,
    resourceBias: 'astatine',
    seed: 'astatine-deposits-epsilon',
    count: 10,
    biasFraction: 0.85,
    hiddenMin: 2,
    hiddenMax: 4,
    richnessMin: 50,
    richnessMax: 95,
  },
];

/** Isolated asteroids scattered outside clusters to create sparse regions */
interface IsolatedAsteroidDef {
  x: number;
  y: number;
  resourceType: AsteroidResourceType;
  richness: number;
  hiddenLevel: number;
  stability: number;
}

const ISOLATED_ASTEROIDS: IsolatedAsteroidDef[] = [
  { x: 500, y: 500, resourceType: 'carbon', richness: 20, hiddenLevel: 0, stability: 70 },
  { x: -800, y: -400, resourceType: 'titanium', richness: 30, hiddenLevel: 0, stability: 75 },
  { x: 1200, y: -800, resourceType: 'carbon', richness: 18, hiddenLevel: 0, stability: 65 },
  { x: -200, y: 1800, resourceType: 'hydrogenium', richness: 45, hiddenLevel: 1, stability: 80 },
  { x: 4000, y: 2000, resourceType: 'titanium', richness: 22, hiddenLevel: 0, stability: 72 },
  { x: -3000, y: 500, resourceType: 'carbon', richness: 12, hiddenLevel: 0, stability: 68 },
  { x: 2500, y: -2500, resourceType: 'kyber_crystal', richness: 60, hiddenLevel: 2, stability: 85 },
  { x: -1000, y: -3500, resourceType: 'astatine', richness: 55, hiddenLevel: 3, stability: 90 },
  { x: 100, y: 3200, resourceType: 'titanium', richness: 28, hiddenLevel: 0, stability: 72 },
  { x: -4000, y: -1000, resourceType: 'carbon', richness: 10, hiddenLevel: 0, stability: 68 },
  { x: 3000, y: 3000, resourceType: 'hydrogenium', richness: 38, hiddenLevel: 1, stability: 80 },
  { x: -2000, y: 3500, resourceType: 'kyber_crystal', richness: 70, hiddenLevel: 2, stability: 85 },
  { x: 1500, y: -4000, resourceType: 'astatine', richness: 80, hiddenLevel: 3, stability: 90 },
  { x: -3500, y: 3000, resourceType: 'carbon', richness: 15, hiddenLevel: 0, stability: 70 },
  { x: 4500, y: -500, resourceType: 'titanium', richness: 32, hiddenLevel: 0, stability: 75 },
];

export const seedAsteroidWorld = async (): Promise<void> => {
  const db = getDb();

  // Idempotency check — skip if any asteroids already exist
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(asteroids);
  if ((countRow?.count ?? 0) > 0) return;

  // 1. Insert clusters
  const insertedClusters = await db
    .insert(asteroidClusters)
    .values(
      CLUSTER_DEFS.map((def) => ({
        name: def.name,
        centerX: def.centerX,
        centerY: def.centerY,
        radius: def.radius,
        resourceBias: def.resourceBias,
        seed: def.seed,
      })),
    )
    .returning();

  // 2. Insert asteroids for each cluster
  for (const clusterRow of insertedClusters) {
    const def = CLUSTER_DEFS.find((d) => d.name === clusterRow.name)!;
    const rng = new SeededRng(def.seed + ':asteroids');
    const positions = generateClusterPositions(
      { centerX: def.centerX, centerY: def.centerY, radius: def.radius, seed: def.seed },
      def.count,
    );

    const asteroidValues = positions.map((pos) => {
      const useBias = rng.next() < def.biasFraction;
      const resourceType: AsteroidResourceType = useBias
        ? def.resourceBias
        : rng.pick(ALL_RESOURCE_TYPES.filter((r) => r !== def.resourceBias));
      const { chunkX, chunkY } = worldToChunk(pos.x, pos.y);

      return {
        x: pos.x,
        y: pos.y,
        chunkX,
        chunkY,
        resourceType,
        richness: rng.nextInt(def.richnessMin, def.richnessMax),
        stability: rng.nextInt(60, 99),
        hiddenLevel: rng.nextInt(def.hiddenMin, def.hiddenMax),
        clusterId: clusterRow.id,
      };
    });

    await db.insert(asteroids).values(asteroidValues);
  }

  // 3. Insert isolated asteroids (sparse regions)
  const isolatedValues = ISOLATED_ASTEROIDS.map((a) => {
    const { chunkX, chunkY } = worldToChunk(a.x, a.y);
    return {
      x: a.x,
      y: a.y,
      chunkX,
      chunkY,
      resourceType: a.resourceType,
      richness: a.richness,
      stability: a.stability,
      hiddenLevel: a.hiddenLevel,
      clusterId: null,
    };
  });

  await db.insert(asteroids).values(isolatedValues);
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
