import { eq, and, sql, asc } from 'drizzle-orm';
import { publishUserEvent } from '../lib/realtime.js';
import { getDb } from '../lib/db/index.js';
import { buildingDefinitions } from '../lib/db/schema/building-definitions.js';
import { stationBuildings } from '../lib/db/schema/station-buildings.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stations } from '../lib/db/schema/stations.js';
import {
  calculateBuildingUpgradeCost,
  calculateBuildingBuildTime,
  calculateBuildingEffect,
  getBuildingUnlockMilestones,
  isBuildingPlayable,
} from '@orions-frontier/game-config';
import type {
  StationBuildingWithDefinition,
  BuildingKey,
  BuildingDefinition,
} from '@orions-frontier/shared';
import { AppError, ErrorCode } from '@orions-frontier/shared';

// ============================================================================
// Seed station buildings (initialize all buildings at level 1 for new station)
// ============================================================================

type SeedDb = Pick<ReturnType<typeof getDb>, 'select' | 'insert'>;

export const seedStationBuildings = async (
  stationId: string,
  db: SeedDb = getDb()
): Promise<void> => {
  const defs = await db.select().from(buildingDefinitions);
  if (defs.length === 0) return;

  await db
    .insert(stationBuildings)
    .values(
      defs.map((def) => ({
        stationId,
        buildingDefinitionId: def.id,
        level: 1,
      }))
    )
    .onConflictDoNothing();
};

// ============================================================================
// Get all buildings for a station (with computed effects / costs)
// ============================================================================

export const getStationBuildings = async (
  stationId: string
): Promise<StationBuildingWithDefinition[]> => {
  const db = getDb();

  // Auto-seed buildings for stations created before the building system existed
  const existing = await db
    .select({ id: stationBuildings.id })
    .from(stationBuildings)
    .where(eq(stationBuildings.stationId, stationId))
    .limit(1);

  if (existing.length === 0) {
    await seedStationBuildings(stationId);
  }

  const rows = await db
    .select({
      building: stationBuildings,
      definition: buildingDefinitions,
    })
    .from(stationBuildings)
    .innerJoin(
      buildingDefinitions,
      eq(stationBuildings.buildingDefinitionId, buildingDefinitions.id)
    )
    .where(eq(stationBuildings.stationId, stationId))
    .orderBy(asc(buildingDefinitions.key));

  const now = new Date();

  return rows.map(({ building, definition }) => {
    const key = definition.key as BuildingKey;
    const level = building.level;
    const upgradeEndsAt = building.upgradeEndsAt;
    const isUpgrading = upgradeEndsAt !== null && upgradeEndsAt > now;
    const isAtMax = level >= definition.maxLevel;

    const sharedDef: BuildingDefinition = {
      id: definition.id,
      key,
      name: definition.name,
      description: definition.description,
      image: definition.image,
      baseBuildTime: definition.baseBuildTime,
      maxLevel: definition.maxLevel,
      effectType: definition.effectType as BuildingDefinition['effectType'],
      createdAt: definition.createdAt.toISOString(),
    };

    return {
      definition: sharedDef,
      level,
      upgradeEndsAt: upgradeEndsAt ? upgradeEndsAt.toISOString() : null,
      isUpgrading,
      effects: calculateBuildingEffect(key, level),
      nextLevelEffects: isAtMax ? null : calculateBuildingEffect(key, level + 1),
      upgradeCosts: isAtMax ? [] : calculateBuildingUpgradeCost(key, level + 1),
      unlockMilestones: getBuildingUnlockMilestones(key),
    };
  });
};

// ============================================================================
// Start building upgrade
// ============================================================================

export const startBuildingUpgrade = async (
  stationId: string,
  buildingKey: BuildingKey,
  userId: string
): Promise<StationBuildingWithDefinition> => {
  if (!isBuildingPlayable(buildingKey)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `${buildingKey} is not available yet`);
  }

  const db = getDb();

  // Load definition
  const [def] = await db
    .select()
    .from(buildingDefinitions)
    .where(eq(buildingDefinitions.key, buildingKey))
    .limit(1);

  if (!def) {
    throw new AppError(ErrorCode.NOT_FOUND, `Building definition '${buildingKey}' not found`);
  }

  const resourceMap = await db.transaction(async (tx) => {
    const [station] = await tx
      .select({ id: stations.id })
      .from(stations)
      .where(and(eq(stations.id, stationId), eq(stations.userId, userId)))
      .for('update');
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

    const [stationBuilding] = await tx
      .select()
      .from(stationBuildings)
      .where(
        and(
          eq(stationBuildings.stationId, stationId),
          eq(stationBuildings.buildingDefinitionId, def.id)
        )
      )
      .limit(1)
      .for('update');

    if (!stationBuilding) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Station building not found');
    }
    if (stationBuilding.upgradeEndsAt) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Building is already upgrading');
    }
    if (stationBuilding.level >= def.maxLevel) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Building is already at max level');
    }

    const targetLevel = stationBuilding.level + 1;
    const costs = calculateBuildingUpgradeCost(buildingKey, targetLevel);
    const resourceRows = await tx
      .select()
      .from(stationResources)
      .where(eq(stationResources.stationId, stationId));
    const currentResources = new Map(resourceRows.map((row) => [row.resourceKey, row.amount]));

    for (const cost of costs) {
      const current = currentResources.get(cost.resourceKey) ?? 0;
      if (current < cost.amount) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Insufficient ${cost.resourceKey}: need ${cost.amount}, have ${current}`
        );
      }
    }

    const buildTimeSeconds = calculateBuildingBuildTime(buildingKey, targetLevel);
    const upgradeEndsAt = new Date(Date.now() + buildTimeSeconds * 1000);
    for (const cost of costs) {
      await tx
        .update(stationResources)
        .set({ amount: sql`${stationResources.amount} - ${cost.amount}` })
        .where(
          and(
            eq(stationResources.stationId, stationId),
            eq(stationResources.resourceKey, cost.resourceKey)
          )
        );
      currentResources.set(
        cost.resourceKey,
        (currentResources.get(cost.resourceKey) ?? 0) - cost.amount
      );
    }

    await tx
      .update(stationBuildings)
      .set({ upgradeEndsAt, updatedAt: new Date() })
      .where(eq(stationBuildings.id, stationBuilding.id));

    return currentResources;
  });

  publishUserEvent(userId, 'resources_updated', {
    stationId,
    resources: Object.fromEntries(resourceMap),
  });

  const allBuildings = await getStationBuildings(stationId);
  const result = allBuildings.find((b) => b.definition.key === buildingKey);

  if (!result) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Failed to retrieve updated building');
  }

  return result;
};
