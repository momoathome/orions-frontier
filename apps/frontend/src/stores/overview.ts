import { computed, reactive } from 'vue';
import {
  getCostShortfall,
  getMiningTripPhase,
  getMiningTripPhaseEndsAt,
  summarizeStationIncome,
  type AsteroidDetail,
  type CombatReport,
  type LogbookEntry,
  type Ranking,
  type Station,
  type StationIncome,
  type StationBuildingWithDefinition,
  type StationSpacecraftsResponse,
  type UserResourceSummary,
  type WorldTripPurpose,
} from '@orions-frontier/shared';
import { apiClient } from '../lib/api-client.js';
import { wsClient } from '../lib/ws-client.js';
import { debounced } from '../lib/debounce.js';
import { resourceName } from '../lib/mining-utils.js';

/** Row of GET /me/trips. */
export interface OverviewTrip {
  id: string;
  groupSize: number;
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  departedAt: string;
  arrivesAt: string;
  purpose: WorldTripPurpose;
  spacecraft: { name: string; role: string } | null;
}

export interface StationDetail {
  resources: UserResourceSummary | null;
  buildings: StationBuildingWithDefinition[];
  fleet: StationSpacecraftsResponse | null;
  income: StationIncome | null;
}

export const stationSections = [
  'buildings',
  'fleet',
  'logistics',
  'research',
  'frontier',
  'defense',
] as const;
export type StationSection = (typeof stationSections)[number];

export type AlertTone = 'danger' | 'warning' | 'info';
export interface Alert {
  key: string;
  tone: AlertTone;
  title: string;
  detail: string;
  stationId: string;
  section: StationSection;
}

export interface Operation {
  id: string;
  kind: 'outbound' | 'mining' | 'returning' | 'mission' | 'build';
  title: string;
  detail: string;
  stationId: string;
  section: StationSection;
  endsAt: number;
}

const LOGBOOK_SEEN_KEY = 'logbook_seen_at';
const STORAGE_WARNING = 0.9;

interface OverviewState {
  stations: Station[];
  details: Record<string, StationDetail>;
  trips: OverviewTrip[];
  combats: CombatReport[];
  logbook: LogbookEntry[];
  ranking: Ranking | null;
  logbookSeenAt: number;
  online: boolean;
  now: number;
}

const state = reactive<OverviewState>({
  stations: [],
  details: {},
  trips: [],
  combats: [],
  logbook: [],
  ranking: null,
  logbookSeenAt: Number(localStorage.getItem(LOGBOOK_SEEN_KEY) ?? 0),
  online: true,
  now: Date.now(),
});

const stationName = (id: string) => state.stations.find((s) => s.id === id)?.name ?? 'Station';

// ponytail: one asteroid request per mined asteroid; add a station income endpoint if stations
// regularly mine more than a handful of asteroids.
async function loadStationIncome(id: string): Promise<StationIncome> {
  const { assignments } = await apiClient.get<{ assignments: { asteroidId: string }[] }>(
    `/stations/${id}/mining-assignments`
  );
  const asteroidIds = [...new Set(assignments.map((assignment) => assignment.asteroidId))];
  const asteroids = await Promise.all(
    asteroidIds.map((asteroidId) => apiClient.get<AsteroidDetail>(`/asteroids/${asteroidId}`))
  );
  return summarizeStationIncome(id, asteroids);
}

async function loadStationDetail(id: string): Promise<void> {
  const [resources, buildings, fleet, income] = await Promise.all([
    apiClient.get<UserResourceSummary>('/me/resources', { params: { stationId: id } }),
    apiClient.get<{ buildings: StationBuildingWithDefinition[] }>(`/stations/${id}/buildings`),
    apiClient.get<StationSpacecraftsResponse>(`/stations/${id}/spacecrafts`),
    loadStationIncome(id),
  ]);
  state.details[id] = { resources, buildings: buildings.buildings, fleet, income };
}

async function guarded(load: () => Promise<unknown>): Promise<void> {
  try {
    await load();
    state.online = true;
  } catch {
    state.online = false;
  }
}

const refreshStation = (id: string) => guarded(() => loadStationDetail(id));
const refreshTrips = () =>
  guarded(async () => (state.trips = await apiClient.get<OverviewTrip[]>('/me/trips')));
const refreshCombats = () =>
  guarded(async () => (state.combats = await apiClient.get<CombatReport[]>('/me/combats')));
const refreshLogbook = () =>
  guarded(
    async () =>
      (state.logbook = await apiClient.get<LogbookEntry[]>('/me/logbook', {
        params: { limit: 50 },
      }))
  );
const refreshRanking = () =>
  guarded(
    async () =>
      (state.ranking = await apiClient.get<Ranking>('/world/ranking', { params: { limit: 1 } }))
  );

async function refreshAll(): Promise<void> {
  await guarded(async () => (state.stations = await apiClient.get<Station[]>('/stations')));
  await Promise.all([
    ...state.stations.map((station) => refreshStation(station.id)),
    refreshTrips(),
    refreshCombats(),
    refreshLogbook(),
    refreshRanking(),
  ]);
}

// Ticks settle many trips at once; reload once per burst.
const scheduleAll = debounced(refreshAll, 1_000);
const scheduleProgress = debounced(() => Promise.all([refreshLogbook(), refreshRanking()]), 500);

let subscribers = 0;
let stopSync: (() => void) | null = null;

/** Loads the account overview and keeps it current while at least one view uses it. */
function start(): () => void {
  subscribers += 1;
  if (subscribers === 1) {
    void refreshAll();
    const clock = window.setInterval(() => (state.now = Date.now()), 1_000);
    const unsubscribers = [
      wsClient.on('resources_updated', ({ stationId, resources }) => {
        const detail = state.details[stationId];
        if (detail?.resources)
          detail.resources.resources = { ...detail.resources.resources, ...resources };
      }),
      wsClient.on('mining_tick_completed', scheduleAll),
      wsClient.on('transport_tick_completed', scheduleAll),
      wsClient.on('building_upgrade_completed', ({ stationId }) => {
        void refreshStation(stationId);
        scheduleProgress();
      }),
      wsClient.on('defense_upgrade_completed', scheduleProgress),
      wsClient.on('spacecraft_build_completed', ({ stationId }) => {
        void refreshStation(stationId);
        scheduleProgress();
      }),
      wsClient.on('world_mission_completed', scheduleAll),
      wsClient.on('incoming_attack', () => void refreshCombats()),
    ];
    stopSync = () => {
      window.clearInterval(clock);
      scheduleAll.cancel();
      scheduleProgress.cancel();
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }
  return () => {
    subscribers -= 1;
    if (subscribers === 0) stopSync?.();
  };
}

/** Running building upgrades and spacecraft orders of one station. */
function stationQueue(id: string): { count: number; nextEndsAt: number | null } {
  const detail = state.details[id];
  const endsAt = [
    ...(detail?.buildings ?? []).flatMap((b) =>
      b.isUpgrading && b.upgradeEndsAt ? [Date.parse(b.upgradeEndsAt)] : []
    ),
    ...(detail?.fleet?.spacecrafts ?? []).flatMap((s) =>
      s.buildOrders.map((order) => Date.parse(order.endsAt))
    ),
  ].filter((time) => time > state.now);
  return { count: endsAt.length, nextEndsAt: endsAt.length ? Math.min(...endsAt) : null };
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

function affordableUpgrades(id: string): StationBuildingWithDefinition[] {
  const detail = state.details[id];
  if (!detail?.resources) return [];
  const { resources, rates } = detail.resources;
  return detail.buildings.filter(
    (b) =>
      !b.isUpgrading &&
      b.level < b.definition.maxLevel &&
      getCostShortfall(b.upgradeCosts, resources, rates).missing.length === 0
  );
}

const alerts = computed<Alert[]>(() => {
  const list: Alert[] = [];
  for (const report of state.combats) {
    const station = state.stations.find((s) => s.id === report.defenderStationId);
    if (!station || report.status !== 'traveling') continue;
    list.push({
      key: `attack:${report.id}`,
      tone: 'danger',
      title: 'Incoming attack',
      detail: station.name,
      stationId: station.id,
      section: 'defense',
    });
  }
  for (const station of state.stations) {
    const idleMiners = stationFleet(station.id).idleMiners;
    if (idleMiners > 0) {
      list.push({
        key: `idle:${station.id}`,
        tone: 'warning',
        title: `${idleMiners} ${idleMiners === 1 ? 'miner' : 'miners'} idle`,
        detail: `${station.name}: assign them to an asteroid`,
        stationId: station.id,
        section: 'logistics',
      });
    }
    const storage = stationStorage(station.id);
    if (storage.resourceKey && storage.fill >= STORAGE_WARNING) {
      list.push({
        key: `storage:${station.id}`,
        tone: 'warning',
        title: `${resourceName(storage.resourceKey)} storage ${Math.round(storage.fill * 100)}%`,
        detail: `${station.name}: upgrade the Warehouse`,
        stationId: station.id,
        section: 'buildings',
      });
    }
    const affordable = affordableUpgrades(station.id);
    if (affordable.length > 0) {
      list.push({
        key: `upgrade:${station.id}`,
        tone: 'info',
        title:
          affordable.length === 1
            ? `${affordable[0]?.definition.name} upgrade affordable`
            : `${affordable.length} upgrades affordable`,
        detail: station.name,
        stationId: station.id,
        section: 'buildings',
      });
    }
  }
  return list;
});

function tripStationId(trip: OverviewTrip): string {
  return trip.fromType === 'station' && state.stations.some((s) => s.id === trip.fromId)
    ? trip.fromId
    : trip.toId;
}

const MISSION_TITLES: Partial<Record<WorldTripPurpose, string>> = {
  combat: 'Attack fleet en route',
  combat_return: 'Attack fleet returning',
  expedition: 'Expedition',
  colonization: 'Colony ship en route',
  salvage: 'Salvage fleet en route',
  salvage_return: 'Salvage fleet returning',
  relocate: 'Station relocating',
};

const operations = computed<Operation[]>(() => {
  const list: Operation[] = [];
  for (const trip of state.trips) {
    const timing = {
      purpose: trip.purpose,
      departedAt: Date.parse(trip.departedAt),
      arrivesAt: Date.parse(trip.arrivesAt),
    };
    const stationId = tripStationId(trip);
    const ships = `${trip.groupSize}× ${trip.spacecraft?.name ?? 'spacecraft'}`;
    const phase = getMiningTripPhase(timing, state.now);
    const endsAt = phase ? getMiningTripPhaseEndsAt(timing, state.now) : timing.arrivesAt;
    if (!endsAt || endsAt <= state.now) continue;
    const title = phase
      ? { outbound: 'Flying to asteroid', mining: 'Mining', returning: 'Delivering cargo' }[phase]
      : (MISSION_TITLES[trip.purpose] ?? 'Fleet en route');
    list.push({
      id: trip.id,
      kind: phase ?? 'mission',
      title,
      detail: `${ships} from ${stationName(stationId)}`,
      stationId,
      section: phase ? 'logistics' : trip.purpose.startsWith('combat') ? 'defense' : 'frontier',
      endsAt,
    });
  }
  for (const station of state.stations) {
    const detail = state.details[station.id];
    for (const building of detail?.buildings ?? []) {
      if (!building.isUpgrading || !building.upgradeEndsAt) continue;
      list.push({
        id: `building:${station.id}:${building.definition.key}`,
        kind: 'build',
        title: `${building.definition.name} Lv. ${building.level + 1}`,
        detail: station.name,
        stationId: station.id,
        section: 'buildings',
        endsAt: Date.parse(building.upgradeEndsAt),
      });
    }
    for (const ship of detail?.fleet?.spacecrafts ?? []) {
      for (const order of ship.buildOrders) {
        list.push({
          id: `order:${order.id}`,
          kind: 'build',
          title: `${order.amount}× ${ship.definition.name}`,
          detail: `Shipyard at ${station.name}`,
          stationId: station.id,
          section: 'fleet',
          endsAt: Date.parse(order.endsAt),
        });
      }
    }
  }
  return list.filter((op) => op.endsAt > state.now).sort((a, b) => a.endsAt - b.endsAt);
});

const unseenLogbook = computed(() =>
  state.logbook.filter((entry) => Date.parse(entry.occurredAt) > state.logbookSeenAt)
);

function markLogbookSeen(): void {
  state.logbookSeenAt = Date.now();
  localStorage.setItem(LOGBOOK_SEEN_KEY, String(state.logbookSeenAt));
}

const overviewStore = reactive({
  state,
  alerts,
  operations,
  unseenLogbook,
  start,
  refreshAll,
  refreshStation,
  refreshTrips,
  stationName,
  stationQueue,
  stationFleet,
  stationStorage,
  markLogbookSeen,
});

export const useOverviewStore = () => overviewStore;
