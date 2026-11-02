import {
  coarseIntegrity,
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
  resourceKeys,
  type LogbookEntry,
  type LogbookEntryType,
  type ResourceMap,
} from '@orions-frontier/shared';
import { getDb } from '../../lib/db/index.js';
import {
  insertLogbookEntries,
  listLogbookEntriesByUser,
  type NewLogbookEntry,
} from './repositories/logbook-entries.js';
import type { PlaytestCompletionEvent } from '../../lib/completion-events.js';

type NewEntry = NewLogbookEntry;

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
    case 'miners_assigned': {
      const name = getSpacecraft(event.spacecraftKey)?.name ?? event.spacecraftKey;
      const resource = isOneOf(resourceKeys, event.resourceKey)
        ? resources[event.resourceKey].name
        : event.resourceKey;
      const verb = event.rerouted ? 'rerouted' : 'sent';
      return [
        entry(event, event.type, `${event.amount}× ${name} ${verb} to a ${resource} asteroid`),
      ];
    }
    case 'research_completed': {
      const name = getResearchDefinition(event.technologyKey)?.name ?? event.technologyKey;
      return [entry(event, event.type, `Research completed: ${name} ${event.newLevel}`)];
    }
    case 'queue_job_dropped': {
      const name =
        event.kind === 'research'
          ? (getResearchDefinition(event.key)?.name ?? event.key)
          : isOneOf(buildingKeys, event.key)
            ? getBuilding(event.key).name
            : isOneOf(defenseUpgradeKeys, event.key)
              ? getDefenseUpgrade(event.key).name
              : event.key;
      return [
        entry(
          event,
          event.type,
          `Queued ${name} ${event.targetLevel} could not start, refunded ${resourceList(event.refunded)}`
        ),
      ];
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
      if (event.winner === 'none') {
        return [entry(event, event.type, 'Attack target was already destroyed, fleet turned back')];
      }
      const won = event.winner === 'attacker';
      const losses = `losses: ${event.attackerLosses} attacker, ${event.defenderLosses} defender`;
      // The attacker learns the integrity in coarse tiers only, like the combat report.
      const integrity = (shown: (value: number) => number) =>
        event.stationDestroyed
          ? ' Station destroyed.'
          : event.integrityDamage > 0 && event.defenderIntegrity !== null
            ? ` Integrity -${event.integrityDamage} to ${shown(event.defenderIntegrity)}.`
            : '';
      const entries = [
        entry(
          event,
          event.type,
          `Attack ${won ? 'succeeded' : 'repelled'} (${losses}).${integrity(coarseIntegrity)}`
        ),
      ];
      if (defenderUserId && defenderUserId !== event.userId) {
        entries.push(
          entry(
            event,
            'combat_defended',
            `Station attacked, ${won ? 'defense broken' : 'attack repelled'} (${losses}).${integrity((value) => value)}`,
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
 * known-limit: written after the completing transaction; a crash in between loses that entry only.
 */
export async function recordLogbookEvents(events: readonly PlaytestCompletionEvent[]) {
  if (events.length === 0) return;
  const rows = events.flatMap((event) =>
    entriesFor(event, event.type === 'combat_resolved' ? event.defenderUserId : undefined)
  );
  if (rows.length === 0) return;
  await insertLogbookEntries(getDb(), rows);
}

const COMBAT_ENTRY_TYPES = new Set<LogbookEntryType>([
  'combat_resolved',
  'combat_defended',
  'loot_delivered',
]);

export async function getLogbook(
  userId: string,
  page: { limit: number; offset: number }
): Promise<LogbookEntry[]> {
  const rows = await listLogbookEntriesByUser(getDb(), userId, page);
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    stationId: row.stationId,
    summary: row.summary,
    occurredAt: row.occurredAt.toISOString(),
    // Combat event ids are `kind:missionId:stage` (completionEventId), so the entry links its report.
    combatId: COMBAT_ENTRY_TYPES.has(row.type) ? (row.eventId.split(':')[1] ?? null) : null,
  }));
}
