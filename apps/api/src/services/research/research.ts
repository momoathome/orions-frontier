import { AppError, ErrorCode, type ResearchState } from '@orions-frontier/shared';
import {
  calculateBuildingEffect,
  getResearchDefinition,
  researchDefinitions,
} from '@orions-frontier/game-config';
import { getDb, type QueryDb } from '../../lib/db/index.js';
import { findBuildingLevel } from '../../repositories/station-buildings.js';
import {
  claimDueResearch,
  insertStationResearch,
  listDueResearch,
  listStationResearch,
} from '../../repositories/station-research.js';
import {
  deductStationResource,
  listStationResourcesForUpdate,
} from '../../repositories/station-resources.js';
import { findOwnedStation, findOwnedStationForUpdate } from '../../repositories/stations.js';
import {
  createRealtimeExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';
import { completionEventId, type ResearchCompletedEvent } from '../../lib/completion-events.js';

const researchCapacity = (level: number) =>
  calculateBuildingEffect('laboratory', level).find((effect) => effect.type === 'research_capacity')
    ?.value ?? 0;

async function laboratoryLevel(db: QueryDb, stationId: string): Promise<number> {
  return (await findBuildingLevel(db, stationId, 'laboratory')) ?? 0;
}

export async function getResearchState(stationId: string, userId: string): Promise<ResearchState> {
  const db = getDb();
  const station = await findOwnedStation(db, stationId, userId);
  if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

  const [level, rows] = await Promise.all([
    laboratoryLevel(db, stationId),
    listStationResearch(db, stationId),
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
  technologyKey: string,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> {
  const definition = getResearchDefinition(technologyKey);
  if (!definition) throw new AppError(ErrorCode.NOT_FOUND, 'Research not found');

  await getDb().transaction(async (tx) => {
    const station = await findOwnedStationForUpdate(tx, stationId, userId);
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

    const [level, rows] = await Promise.all([
      laboratoryLevel(tx, stationId),
      listStationResearch(tx, stationId),
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

    const resources = await listStationResourcesForUpdate(tx, stationId);
    const amounts = new Map(resources.map((row) => [row.resourceKey, row.amount]));
    for (const cost of definition.costs) {
      if ((amounts.get(cost.resourceKey) ?? 0) < cost.amount) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, `Insufficient ${cost.resourceKey}`);
      }
    }
    for (const cost of definition.costs) {
      await deductStationResource(tx, stationId, cost.resourceKey, cost.amount);
    }
    await insertStationResearch(tx, {
      id: context.nextId('station-research'),
      stationId,
      technologyKey,
      completesAt: new Date(context.now.getTime() + definition.duration * 1000),
      createdAt: context.now,
    });
  });
}

export { hasCompletedResearch } from '../../repositories/station-research.js';

export async function completeDueResearchDetailed(
  now = new Date()
): Promise<ResearchCompletedEvent[]> {
  const db = getDb();
  const due = await listDueResearch(db, now);
  const events: ResearchCompletedEvent[] = [];
  for (const research of due) {
    const claimed = await claimDueResearch(db, research.id, research.completesAt, now);
    if (claimed) {
      events.push({
        type: 'research_completed',
        eventId: completionEventId('research_completed', research.id),
        occurredAt: research.completesAt,
        userId: research.userId,
        stationId: research.stationId,
        researchId: research.id,
        technologyKey: research.technologyKey,
      });
    }
  }
  return events;
}

export async function completeDueResearch(now = new Date()): Promise<number> {
  return (await completeDueResearchDetailed(now)).length;
}
