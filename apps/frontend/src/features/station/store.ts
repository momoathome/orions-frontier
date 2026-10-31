import { reactive } from 'vue';
import { calculateConstructionSpeedBonus, durationFactor } from '@orions-frontier/game-config';
import {
  getCostShortfall,
  QUEUE_LIMIT,
  summarizeStationIncome,
  type AsteroidDetail,
  type BuildSlots,
  type Station,
  type StationIncome,
  type StationBuildingWithDefinition,
  type StationSpacecraftsResponse,
  type UserResourceSummary,
} from '@orions-frontier/shared';
import { apiClient } from '../../shared/api/api-client.js';
import { wsClient } from '../../shared/api/ws-client.js';
import { guarded, live } from '../../shared/lib/live.js';
import { useResearchStore } from '../research/index.js';

/** Row of GET /stations/:id/mining-assignments. */
export interface MiningAssignment {
  asteroidId: string;
  asteroidX: number;
  asteroidY: number;
  asteroidSize: string;
}

export interface StationDetail {
  resources: UserResourceSummary | null;
  buildings: StationBuildingWithDefinition[];
  buildSlots: BuildSlots | null;
  fleet: StationSpacecraftsResponse | null;
  income: StationIncome | null;
  assignments: MiningAssignment[];
}

export const stationSections = ['buildings', 'fleet', 'logistics', 'frontier', 'defense'] as const;
export type StationSection = (typeof stationSections)[number];

interface StationState {
  stations: Station[];
  details: Record<string, StationDetail>;
}

const state = reactive<StationState>({ stations: [], details: {} });
const research = useResearchStore();

const stationName = (id: string) => state.stations.find((s) => s.id === id)?.name ?? 'Station';

// ponytail: one asteroid request per mined asteroid; add a station income endpoint if stations
// regularly mine more than a handful of asteroids.
async function loadStationIncome(
  id: string
): Promise<{ income: StationIncome; assignments: MiningAssignment[] }> {
  const { assignments } = await apiClient.get<{ assignments: MiningAssignment[] }>(
    `/stations/${id}/mining-assignments`
  );
  const asteroidIds = [...new Set(assignments.map((assignment) => assignment.asteroidId))];
  const asteroids = await Promise.all(
    asteroidIds.map((asteroidId) => apiClient.get<AsteroidDetail>(`/asteroids/${asteroidId}`))
  );
  return { income: summarizeStationIncome(id, asteroids, research.modifiers.yield), assignments };
}

// Overlapping refreshes of one station: only the latest request may write its detail.
const stationRequests: Record<string, number> = {};

async function loadStationDetail(id: string): Promise<void> {
  const request = (stationRequests[id] = (stationRequests[id] ?? 0) + 1);
  const [resources, buildings, fleet, mining] = await Promise.all([
    apiClient.get<UserResourceSummary>('/me/resources', { params: { stationId: id } }),
    apiClient.get<{ buildings: StationBuildingWithDefinition[]; buildSlots: BuildSlots }>(
      `/stations/${id}/buildings`
    ),
    apiClient.get<StationSpacecraftsResponse>(`/stations/${id}/spacecrafts`),
    loadStationIncome(id),
  ]);
  if (request !== stationRequests[id]) return;
  state.details[id] = {
    resources,
    buildings: buildings.buildings,
    buildSlots: buildings.buildSlots,
    fleet,
    ...mining,
  };
}

const refreshStation = (id: string) => guarded(() => loadStationDetail(id));
const refreshStations = () =>
  guarded(async () => (state.stations = await apiClient.get<Station[]>('/stations')));

let subscribers = 0;
let stopSync: (() => void) | null = null;
let stationsLoaded: Promise<void> = Promise.resolve();

/**
 * Loads the station list and keeps stations current on their own events. Station details load
 * through the overview, which also reloads everything after ticks and reconnects.
 */
function start(): () => void {
  subscribers += 1;
  if (subscribers === 1) {
    stationsLoaded = refreshStations();
    const unsubscribers = [
      wsClient.on('resources_updated', ({ stationId, resources }) => {
        const detail = state.details[stationId];
        if (detail?.resources)
          detail.resources.resources = { ...detail.resources.resources, ...resources };
      }),
      // Scanner upgrades change the station list's scanner range.
      wsClient.on('building_upgrade_completed', ({ stationId }) => {
        void refreshStations();
        void refreshStation(stationId);
      }),
      wsClient.on('defense_upgrade_completed', ({ stationId }) => void refreshStation(stationId)),
      wsClient.on('spacecraft_build_completed', ({ stationId }) => void refreshStation(stationId)),
    ];
    stopSync = () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }
  return () => {
    subscribers -= 1;
    if (subscribers === 0) stopSync?.();
  };
}

/** Running building upgrades and spacecraft orders of one station; research is account-wide. */
function stationQueue(id: string): { count: number; nextEndsAt: number | null } {
  const detail = state.details[id];
  const endsAt = [
    ...(detail?.buildings ?? []).flatMap((b) =>
      b.isUpgrading && b.upgradeEndsAt ? [Date.parse(b.upgradeEndsAt)] : []
    ),
    ...(detail?.fleet?.spacecrafts ?? []).flatMap((s) =>
      s.buildOrders.map((order) => Date.parse(order.endsAt))
    ),
  ].filter((time) => time > live.now);
  const queued = detail?.buildSlots?.queue.length ?? 0;
  return { count: endsAt.length + queued, nextEndsAt: endsAt.length ? Math.min(...endsAt) : null };
}

function stationFleet(id: string): { total: number; idle: number; idleMiners: number } {
  const ships = state.details[id]?.fleet?.spacecrafts ?? [];
  const sum = (pick: (s: (typeof ships)[number]) => number) =>
    ships.reduce((total, s) => total + pick(s), 0);
  return {
    total: sum((s) => s.amount),
    idle: sum((s) => s.amount - s.lockedAmount),
    idleMiners: sum((s) =>
      s.definition.role === 'miner' && s.definition.miningRate > 0 ? s.amount - s.lockedAmount : 0
    ),
  };
}

/** Highest fill of any resource relative to the shared storage cap, 0..1. */
function stationStorage(id: string): { fill: number; resourceKey: string | null } {
  const summary = state.details[id]?.resources;
  if (!summary || summary.storageCapacity <= 0) return { fill: 0, resourceKey: null };
  let best: { fill: number; resourceKey: string | null } = { fill: 0, resourceKey: null };
  for (const [key, amount] of Object.entries(summary.resources)) {
    const fill = amount / summary.storageCapacity;
    if (fill > best.fill) best = { fill, resourceKey: key };
  }
  return best;
}

/** Factor on building upgrade times: Core and Construction Robotics add up, with the server floor. */
function upgradeTimeFactor(id: string): number {
  const core = state.details[id]?.buildings.find((b) => b.definition.key === 'core')?.level ?? 1;
  return durationFactor(
    calculateConstructionSpeedBonus(core) + research.modifiers.constructionBonus
  );
}

/** Unknown slots count as free; the server checks again on start. */
function hasFreeBuildSlot(id: string): boolean {
  const slots = state.details[id]?.buildSlots;
  return !slots || slots.used < slots.total;
}

/** Whether a new level starts at once; otherwise it waits in the station queue. */
function startsNow(
  id: string,
  item: { isUpgrading: boolean; level: number; queuedLevel: number }
): boolean {
  return hasFreeBuildSlot(id) && !item.isUpgrading && item.queuedLevel === item.level;
}

function queueFull(id: string): boolean {
  return (state.details[id]?.buildSlots?.queue.length ?? 0) >= QUEUE_LIMIT;
}

/** Upgrades the station could start right now: paid for, a build slot free and nothing queued. */
function affordableUpgrades(id: string): StationBuildingWithDefinition[] {
  const detail = state.details[id];
  if (!detail?.resources || !hasFreeBuildSlot(id) || detail.buildSlots?.queue.length) return [];
  const { resources, rates } = detail.resources;
  return detail.buildings.filter(
    (b) =>
      startsNow(id, b) &&
      b.level < b.definition.maxLevel &&
      getCostShortfall(b.upgradeCosts, resources, rates).missing.length === 0
  );
}

const stationStore = reactive({
  state,
  start,
  stationsLoaded: () => stationsLoaded,
  refreshStation,
  refreshStations,
  stationName,
  stationQueue,
  startsNow,
  queueFull,
  upgradeTimeFactor,
  affordableUpgrades,
  stationFleet,
  stationStorage,
});

export const useStationStore = () => stationStore;
