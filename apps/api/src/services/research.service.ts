import { and, eq, lte, sql } from 'drizzle-orm';
import { AppError, ErrorCode, type ResearchState } from '@orions-frontier/shared';
import {
  calculateBuildingEffect,
  getResearchDefinition,
  researchDefinitions,
} from '@orions-frontier/game-config';
import { getDb } from '../lib/db/index.js';
import { buildingDefinitions } from '../lib/db/schema/building-definitions.js';
import { stationBuildings } from '../lib/db/schema/station-buildings.js';
import { stationResearch } from '../lib/db/schema/station-research.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stations } from '../lib/db/schema/stations.js';

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];
type QueryDb = Tx | ReturnType<typeof getDb>;

const researchCapacity = (level: number) =>
  calculateBuildingEffect('laboratory', level).find((effect) => effect.type === 'research_capacity')
    ?.value ?? 0;

async function laboratoryLevel(db: QueryDb, stationId: string): Promise<number> {
  const [row] = await db
    .select({ level: stationBuildings.level })
    .from(stationBuildings)
    .innerJoin(
      buildingDefinitions,
      eq(stationBuildings.buildingDefinitionId, buildingDefinitions.id)
    )
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(buildingDefinitions.key, 'laboratory'))
    );
  return row?.level ?? 0;
}

export async function getResearchState(stationId: string, userId: string): Promise<ResearchState> {
  const db = getDb();
  const [station] = await db
    .select({ id: stations.id })
    .from(stations)
    .where(and(eq(stations.id, stationId), eq(stations.userId, userId)));
  if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

  const [level, rows] = await Promise.all([
    laboratoryLevel(db, stationId),
    db.select().from(stationResearch).where(eq(stationResearch.stationId, stationId)),
  ]);
  const byKey = new Map(rows.map((row) => [row.technologyKey, row]));
  const used = rows.reduce(
    (sum, row) => sum + (getResearchDefinition(row.technologyKey)?.points ?? 0),
    0
  );
  return {
    capacity: researchCapacity(level),
    used,
    technologies: researchDefinitions.map((definition) => {
      const row = byKey.get(definition.key);
      return {
        ...definition,
        status: row?.status ?? 'available',
        completesAt: row?.completesAt.toISOString() ?? null,
      };
    }),
  };
}

export async function startResearch(
  stationId: string,
  userId: string,
  technologyKey: string
): Promise<void> {
  const definition = getResearchDefinition(technologyKey);
  if (!definition) throw new AppError(ErrorCode.NOT_FOUND, 'Research not found');

  await getDb().transaction(async (tx) => {
    const [station] = await tx
      .select({ id: stations.id })
      .from(stations)
      .where(and(eq(stations.id, stationId), eq(stations.userId, userId)))
      .for('update');
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

    const [level, rows] = await Promise.all([
      laboratoryLevel(tx, stationId),
      tx.select().from(stationResearch).where(eq(stationResearch.stationId, stationId)),
    ]);
    if (rows.some((row) => row.technologyKey === technologyKey)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Research already started');
    }
    const used = rows.reduce(
      (sum, row) => sum + (getResearchDefinition(row.technologyKey)?.points ?? 0),
      0
    );
    if (used + definition.points > researchCapacity(level)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Laboratory capacity exceeded');
    }

    const resources = await tx
      .select()
      .from(stationResources)
      .where(eq(stationResources.stationId, stationId))
      .for('update');
    const amounts = new Map(resources.map((row) => [row.resourceKey, row.amount]));
    for (const cost of definition.costs) {
      if ((amounts.get(cost.resourceKey) ?? 0) < cost.amount) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, `Insufficient ${cost.resourceKey}`);
      }
    }
    for (const cost of definition.costs) {
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
    await tx.insert(stationResearch).values({
      stationId,
      technologyKey,
      completesAt: new Date(Date.now() + definition.duration * 1000),
    });
  });
}

export async function hasCompletedResearch(
  db: QueryDb,
  stationId: string,
  technologyKey: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: stationResearch.id })
    .from(stationResearch)
    .where(
      and(
        eq(stationResearch.stationId, stationId),
        eq(stationResearch.technologyKey, technologyKey),
        eq(stationResearch.status, 'completed')
      )
    );
  return Boolean(row);
}

export async function completeDueResearch(now = new Date()): Promise<number> {
  const rows = await getDb()
    .update(stationResearch)
    .set({ status: 'completed', completedAt: now })
    .where(and(eq(stationResearch.status, 'researching'), lte(stationResearch.completesAt, now)))
    .returning({ id: stationResearch.id });
  return rows.length;
}
