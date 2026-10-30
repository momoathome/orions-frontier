export const logbookEntryTypes = [
  'building_completed',
  'defense_completed',
  'spacecraft_completed',
  'miners_assigned',
  'research_completed',
  'world_mission_completed',
  'colony_established',
  'combat_resolved',
  'combat_defended',
  'loot_delivered',
  'salvage_completed',
] as const;
export type LogbookEntryType = (typeof logbookEntryTypes)[number];

/** One persisted, player-facing game event (GET /api/me/logbook), newest first. */
export interface LogbookEntry {
  id: string;
  type: LogbookEntryType;
  stationId: string | null;
  summary: string;
  occurredAt: string;
}
