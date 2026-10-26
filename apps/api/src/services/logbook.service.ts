import { desc, eq, inArray } from 'drizzle-orm';
import {
  getBuilding,
  getDefenseUpgrade,
  getResearchDefinition,
  getSpacecraft,
  resources,
} from '@orions-frontier/game-config';
import {
  buildingKeys,
  defenseUpgradeKeys,
  entriesOf,
  isOneOf,
  type LogbookEntry,
  type LogbookEntryType,
  type ResourceMap,
} from '@orions-frontier/shared';
import { getDb } from '../lib/db/index.js';
import { logbookEntries } from '../lib/db/schema/logbook-entries.js';
import { stations } from '../lib/db/schema/stations.js';
import type { PlaytestCompletionEvent } from '../lib/playtest/events.js';

type NewEntry = typeof logbookEntries.$inferInsert;

const resourceList = (map: ResourceMap): string =>
  entriesOf(map)
    .filter(([, amount]) => amount > 0)
    .map(([key, amount]) => `${amount.toLocaleString('en-US')} ${resources[key].name}`)
    .join(', ') || 'nothing';

const MISSION_STAGE: Record<string, string> = {
  target_reached: 'reached its target',
  returned: 'returned home',
  arrived: 'arrived',
};

function entry(
  event: PlaytestCompletionEvent,
  type: LogbookEntryType,
  summary: string,
  userId = event.userId,
  stationId = event.stationId
): NewEntry {
  return {
    userId,
    eventId: event.eventId,
    type,
    stationId,
    summary: summary.slice(0, 255),
    occurredAt: event.occurredAt,
  };
}

/** Maps a completion event to the player-facing entries it produces (mining ticks are noise). */
function entriesFor(event: PlaytestCompletionEvent, defenderUserId?: string): NewEntry[] {
  switch (event.type) {
    case 'building_completed': {
      const name = isOneOf(buildingKeys, event.buildingKey)
        ? getBuilding(event.buildingKey).name
        : event.buildingKey;
      return [entry(event, event.type, `${name} upgraded to level ${event.newLevel}`)];
    }
    case 'defense_completed': {
      const name = isOneOf(defenseUpgradeKeys, event.defenseKey)
        ? getDefenseUpgrade(event.defenseKey).name
        : event.defenseKey;
      return [entry(event, event.type, `${name} upgraded to level ${event.newLevel}`)];
    }
    case 'spacecraft_completed': {
      const name = getSpacecraft(event.spacecraftKey)?.name ?? event.spacecraftKey;
      return [entry(event, event.type, `${event.amount}× ${name} built`)];
    }
    case 'research_completed': {
      const name = getResearchDefinition(event.technologyKey)?.name ?? event.technologyKey;
      return [entry(event, event.type, `Research completed: ${name}`)];
    }
    case 'world_mission_completed': {
      const mission = event.missionType === 'expedition' ? 'Expedition' : 'Colony ship';
      const stage = MISSION_STAGE[event.stage] ?? event.stage;
      return [entry(event, event.type, `${mission} ${stage}`)];
    }
    case 'colony_established':
      return [
        entry(
          event,
          event.type,
          `Colony established in sector ${event.sectorX}, ${event.sectorY}`,
          event.userId,
          event.colonyStationId
        ),
      ];
    case 'combat_resolved': {
      const won = event.winner === 'attacker';
      const losses = `losses: ${event.attackerLosses} attacker, ${event.defenderLosses} defender`;
      const entries = [
        entry(event, event.type, `Attack ${won ? 'succeeded' : 'repelled'} (${losses})`),
      ];
      if (defenderUserId && defenderUserId !== event.userId) {
        entries.push(
          entry(
            event,
            'combat_defended',
            `Station attacked, ${won ? 'defense broken' : 'attack repelled'} (${losses})`,
            defenderUserId,
            event.defenderStationId
          )
        );
      }
      return entries;
    }
    case 'loot_delivered':
      return [entry(event, event.type, `Loot delivered: ${resourceList(event.credited)}`)];
    case 'salvage_completed':
      return [entry(event, event.type, `Salvage delivered: ${resourceList(event.credited)}`)];
    default:
      return [];
  }
}

/**
 * Records completion events in the owning players' logbooks. Idempotent per event id.
 * ponytail: written after the completing transaction; a crash in between loses that entry only.
 */
export async function recordLogbookEvents(events: readonly PlaytestCompletionEvent[]) {
  if (events.length === 0) return;
  const db = getDb();
  const defenderIds = [
    ...new Set(
      events.flatMap((event) => (event.type === 'combat_resolved' ? [event.defenderStationId] : []))
    ),
  ];
  const defenders =
    defenderIds.length === 0
      ? []
      : await db
          .select({ id: stations.id, userId: stations.userId })
          .from(stations)
          .where(inArray(stations.id, defenderIds));
  const defenderOwner = new Map(defenders.map((station) => [station.id, station.userId]));
  const rows = events.flatMap((event) =>
    entriesFor(
      event,
      event.type === 'combat_resolved' ? defenderOwner.get(event.defenderStationId) : undefined
    )
  );
  if (rows.length === 0) return;
  await db.insert(logbookEntries).values(rows).onConflictDoNothing();
}

export async function getLogbook(userId: string, limit: number): Promise<LogbookEntry[]> {
  const rows = await getDb()
    .select()
    .from(logbookEntries)
    .where(eq(logbookEntries.userId, userId))
    .orderBy(desc(logbookEntries.occurredAt), desc(logbookEntries.eventId))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    stationId: row.stationId,
    summary: row.summary,
    occurredAt: row.occurredAt.toISOString(),
  }));
}
