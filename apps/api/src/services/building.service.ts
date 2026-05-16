import { eq, and, sql } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { buildingDefinitions } from '../lib/db/schema/building-definitions.js';
import { stationBuildings } from '../lib/db/schema/station-buildings.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import {
  calculateBuildingUpgradeCost,
  calculateBuildingBuildTime,
  calculateBuildingEffect,
  getBuildingUnlockMilestones,
} from '@orions-frontier/game-config';
import type { StationBuildingWithDefinition, BuildingKey, BuildingDefinition } from '@orions-frontier/shared';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { actionQueue } from '../queue/queues/action-queue.js';

// ============================================================================
// Seed station buildings (initialize all buildings at level 1 for new station)
// ============================================================================

export const seedStationBuildings = async (stationId: string): Promise<void> => {
  const db = getDb();

  const defs = await db.select().from(buildingDefinitions);
  if (defs.length === 0) return;

  await db
    .insert(stationBuildings)
    .values(
      defs.map((def) => ({
        stationId,
        buildingDefinitionId: def.id,
        level: 1,
      })),
    )
    .onConflictDoNothing();
};

// ============================================================================
// Get all buildings for a station (with computed effects / costs)
// ============================================================================

export const getStationBuildings = async (
  stationId: string,
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
    .innerJoin(buildingDefinitions, eq(stationBuildings.buildingDefinitionId, buildingDefinitions.id))
    .where(eq(stationBuildings.stationId, stationId));

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

  // Load station building
  const [stationBuilding] = await db
    .select()
    .from(stationBuildings)
    .where(
      and(
        eq(stationBuildings.stationId, stationId),
        eq(stationBuildings.buildingDefinitionId, def.id)
      )
    )
    .limit(1);

  if (!stationBuilding) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Station building not found');
  }

  if (stationBuilding.upgradeEndsAt && stationBuilding.upgradeEndsAt > new Date()) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Building is already upgrading');
  }

  if (stationBuilding.level >= def.maxLevel) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Building is already at max level');
  }

  const targetLevel = stationBuilding.level + 1;
  const costs = calculateBuildingUpgradeCost(buildingKey, targetLevel);

  // Load current resource amounts for validation
  const resourceRows = await db
    .select()
    .from(stationResources)
    .where(eq(stationResources.stationId, stationId));

  const resourceMap = new Map(resourceRows.map((r) => [r.resourceKey, r.amount]));

  for (const cost of costs) {
    const current = resourceMap.get(cost.resourceKey) ?? 0;
    if (current < cost.amount) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Insufficient ${cost.resourceKey}: need ${cost.amount}, have ${current}`
      );
    }
  }

  // Deduct resources and start upgrade atomically
  const buildTimeSeconds = calculateBuildingBuildTime(buildingKey, targetLevel);
  const upgradeEndsAt = new Date(Date.now() + buildTimeSeconds * 1000);

  await db.transaction(async (tx) => {
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
    }

    await tx
      .update(stationBuildings)
      .set({ upgradeEndsAt, updatedAt: new Date() })
      .where(eq(stationBuildings.id, stationBuilding.id));
  });

  await actionQueue.add(
    'building-upgrade-finished',
    { userId, stationId, buildingKey },
    { delay: buildTimeSeconds * 1000 }
  );

  const allBuildings = await getStationBuildings(stationId);
  const result = allBuildings.find((b) => b.definition.key === buildingKey);

  if (!result) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Failed to retrieve updated building');
  }

  return result;
};
