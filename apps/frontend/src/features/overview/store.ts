import { computed, reactive } from 'vue';
import {
  getMiningTripPhase,
  getMiningTripPhaseEndsAt,
  type ResearchKey,
  type UserTrip,
  type WorldTripPurpose,
} from '@orions-frontier/shared';
import { apiClient } from '../../shared/api/api-client.js';
import { wsClient } from '../../shared/api/ws-client.js';
import { debounced } from '../../shared/lib/debounce.js';
import { gameNow, guarded, live } from '../../shared/lib/live.js';
import { resourceName } from '../../shared/lib/resources.js';
import { useCombatStore } from '../combat/index.js';
import { useLogbookStore } from '../logbook/index.js';
import { useRankingStore } from '../ranking/index.js';
import { useResearchStore } from '../research/index.js';
import { useStationStore, type StationSection } from '../station/index.js';

export type AlertTone = 'danger' | 'warning' | 'info';
export interface Alert {
  key: string;
  tone: AlertTone;
  title: string;
  detail: string;
  stationId: string;
  section: StationSection;
}

interface OperationBase {
  id: string;
  title: string;
  detail: string;
  endsAt: number;
}
/** Station work opens its station section; research is account-wide and opens the research view. */
export type Operation = OperationBase &
  (
    | {
        kind: 'outbound' | 'mining' | 'returning' | 'mission' | 'build';
        stationId: string;
        section: StationSection;
      }
    | { kind: 'research'; research: ResearchKey }
  );

const STORAGE_WARNING = 0.9;

const state = reactive<{ trips: UserTrip[] }>({ trips: [] });
const station = useStationStore();
const combat = useCombatStore();
const logbook = useLogbookStore();
const ranking = useRankingStore();
const research = useResearchStore();

let tripsRequest = 0;
const refreshTrips = () =>
  guarded(async () => {
    const request = ++tripsRequest;
    const trips = await apiClient.get<UserTrip[]>('/me/trips');
    if (request === tripsRequest) state.trips = trips;
  });

async function refreshAll(): Promise<void> {
  await station.refreshStations();
  await refreshRest();
}

async function refreshRest(): Promise<void> {
  await Promise.all([
    ...station.state.stations.map((s) => station.refreshStation(s.id)),
    refreshTrips(),
    combat.refreshCombats(),
    logbook.refreshLogbook(),
    ranking.refreshRanking(),
  ]);
}

// Ticks settle many trips at once; reload once per burst.
const scheduleAll = debounced(refreshAll, 1_000);
const scheduleProgress = debounced(
  () => Promise.all([logbook.refreshLogbook(), ranking.refreshRanking()]),
  500
);

/** Loads the account overview (stations, trips, combats, logbook, ranking) and keeps it current. */
function start(): () => void {
  const stopStations = station.start();
  void station.stationsLoaded().then(refreshRest);
  const clock = window.setInterval(() => (live.now = gameNow()), 1_000);
  const unsubscribers = [
    wsClient.on('mining_tick_completed', scheduleAll),
    wsClient.on('transport_tick_completed', scheduleAll),
    wsClient.on('building_upgrade_completed', scheduleProgress),
    wsClient.on('defense_upgrade_completed', scheduleProgress),
    wsClient.on('spacecraft_build_completed', scheduleProgress),
    wsClient.on('world_mission_completed', scheduleAll),
    // Research changes station modifiers, and Parallel Construction starts queued upgrades.
    wsClient.on('research_completed', scheduleAll),
    wsClient.on('incoming_attack', () => void combat.refreshCombats()),
    // Events sent while the socket was down are lost; reload everything once.
    wsClient.onReconnected(() => void refreshAll()),
  ];
  return () => {
    stopStations();
    window.clearInterval(clock);
    scheduleAll.cancel();
    scheduleProgress.cancel();
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

const alerts = computed<Alert[]>(() => {
  const list: Alert[] = [];
  for (const report of combat.state.combats) {
    const target = station.state.stations.find((s) => s.id === report.defenderStationId);
    if (!target || report.status !== 'traveling') continue;
    list.push({
      key: `attack:${report.id}`,
      tone: 'danger',
      title: 'Incoming attack',
      detail: target.name,
      stationId: target.id,
      section: 'defense',
    });
  }
  for (const own of station.state.stations) {
    const idleMiners = station.stationFleet(own.id).idleMiners;
    if (idleMiners > 0) {
      list.push({
        key: `idle:${own.id}`,
        tone: 'warning',
        title: `${idleMiners} ${idleMiners === 1 ? 'miner' : 'miners'} idle`,
        detail: `${own.name}: assign them to an asteroid`,
        stationId: own.id,
        section: 'logistics',
      });
    }
    const storage = station.stationStorage(own.id);
    if (storage.resourceKey && storage.fill >= STORAGE_WARNING) {
      list.push({
        key: `storage:${own.id}`,
        tone: 'warning',
        title: `${resourceName(storage.resourceKey)} storage ${Math.round(storage.fill * 100)}%`,
        detail: `${own.name}: upgrade the Warehouse`,
        stationId: own.id,
        section: 'buildings',
      });
    }
    const affordable = station.affordableUpgrades(own.id);
    if (affordable.length > 0) {
      list.push({
        key: `upgrade:${own.id}`,
        tone: 'info',
        title:
          affordable.length === 1
            ? `${affordable[0]?.definition.name} upgrade affordable`
            : `${affordable.length} upgrades affordable`,
        detail: own.name,
        stationId: own.id,
        section: 'buildings',
      });
    }
  }
  return list;
});

function tripStationId(trip: UserTrip): string {
  return trip.fromType === 'station' && station.state.stations.some((s) => s.id === trip.fromId)
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
  relocate: 'Fleet relocating',
};

const operations = computed<Operation[]>(() => {
  const now = live.now;
  const list: Operation[] = [];
  for (const tech of research.running) {
    list.push({
      id: `research:${tech.definition.key}`,
      kind: 'research',
      title: `${tech.definition.name} ${tech.level + 1}`,
      detail: 'Research',
      research: tech.definition.key,
      endsAt: Date.parse(tech.completesAt ?? ''),
    });
  }
  for (const trip of state.trips) {
    const timing = {
      purpose: trip.purpose,
      departedAt: Date.parse(trip.departedAt),
      arrivesAt: Date.parse(trip.arrivesAt),
    };
    const stationId = tripStationId(trip);
    const ships = `${trip.groupSize}× ${trip.spacecraft?.name ?? 'spacecraft'}`;
    const phase = getMiningTripPhase(timing, now);
    const endsAt = phase ? getMiningTripPhaseEndsAt(timing, now) : timing.arrivesAt;
    if (!endsAt || endsAt <= now) continue;
    const title = phase
      ? { outbound: 'Flying to asteroid', mining: 'Mining', returning: 'Delivering cargo' }[phase]
      : (MISSION_TITLES[trip.purpose] ?? 'Fleet en route');
    list.push({
      id: trip.id,
      kind: phase ?? 'mission',
      title,
      detail: `${ships} from ${station.stationName(stationId)}`,
      stationId,
      section: phase ? 'logistics' : trip.purpose.startsWith('combat') ? 'defense' : 'frontier',
      endsAt,
    });
  }
  for (const own of station.state.stations) {
    const detail = station.state.details[own.id];
    for (const building of detail?.buildings ?? []) {
      if (!building.isUpgrading || !building.upgradeEndsAt) continue;
      list.push({
        id: `building:${own.id}:${building.definition.key}`,
        kind: 'build',
        title: `${building.definition.name} Lv. ${building.level + 1}`,
        detail: own.name,
        stationId: own.id,
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
          detail: `Shipyard at ${own.name}`,
          stationId: own.id,
          section: 'fleet',
          endsAt: Date.parse(order.endsAt),
        });
      }
    }
  }
  return list.filter((op) => op.endsAt > now).sort((a, b) => a.endsAt - b.endsAt);
});

const overviewStore = reactive({ state, alerts, operations, start, refreshTrips });

export const useOverviewStore = () => overviewStore;
