<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import {
  getMiningTripPhase,
  type AsteroidDetail,
  type StationSpacecraftWithDefinition,
} from '@orions-frontier/shared';
import { apiClient } from '../lib/api-client';
import { wsClient } from '../lib/ws-client';
import { resourceColor, resourceName } from '../lib/mining-utils';
import AsteroidPanel from './AsteroidPanel.vue';

interface MiningAssignment {
  id: string;
  asteroidId: string;
  asteroidX: number;
  asteroidY: number;
  asteroidPrimaryResourceKey: string | null;
  spacecraftName: string;
  assignedAmount: number;
  status: 'traveling_to_asteroid' | 'traveling_to_station';
  recallRequestedAt: string | null;
  recallRequestedAmount: number;
}

interface Trip {
  groupSize: number;
  fromId: string;
  toId: string;
  departedAt: string;
  arrivesAt: string;
  purpose: 'mine' | 'mining_return' | 'combat' | 'combat_return' | 'salvage' | 'salvage_return';
}

const props = defineProps<{ stationId: string }>();
const assignments = ref<MiningAssignment[]>([]);
const details = ref<Record<string, AsteroidDetail>>({});
const fleet = ref<StationSpacecraftWithDefinition[]>([]);
const trips = ref<Trip[]>([]);
const selectedAsteroidId = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const now = ref(Date.now());

function tripPhase(trip: Trip) {
  return getMiningTripPhase(
    {
      purpose: trip.purpose,
      departedAt: new Date(trip.departedAt).getTime(),
      arrivesAt: new Date(trip.arrivesAt).getTime(),
    },
    now.value
  );
}

const stationTrips = computed(() =>
  trips.value.filter((trip) => trip.fromId === props.stationId || trip.toId === props.stationId)
);
const outboundMiners = computed(() =>
  stationTrips.value
    .filter((trip) => tripPhase(trip) === 'outbound')
    .reduce((sum, trip) => sum + trip.groupSize, 0)
);
const miningMiners = computed(() =>
  stationTrips.value
    .filter((trip) => tripPhase(trip) === 'mining')
    .reduce((sum, trip) => sum + trip.groupSize, 0)
);
const returningMiners = computed(() =>
  stationTrips.value
    .filter((trip) => tripPhase(trip) === 'returning')
    .reduce((sum, trip) => sum + trip.groupSize, 0)
);
const assignedMiners = computed(() =>
  assignments.value.reduce((sum, assignment) => sum + assignment.assignedAmount, 0)
);
const availableMiners = computed(() =>
  fleet.value
    .filter((entry) => entry.definition.role === 'miner')
    .reduce((sum, entry) => sum + entry.amount - entry.lockedAmount, 0)
);
const remainingReserve = computed(() =>
  Object.values(details.value).reduce(
    (sum, detail) =>
      sum + detail.veins.reduce((veinSum, vein) => veinSum + vein.remainingAmount, 0),
    0
  )
);

const asteroidRows = computed(() => {
  const grouped = new Map<string, MiningAssignment[]>();
  for (const assignment of assignments.value) {
    const group = grouped.get(assignment.asteroidId) ?? [];
    group.push(assignment);
    grouped.set(assignment.asteroidId, group);
  }
  return [...grouped.entries()].map(([asteroidId, group]) => ({
    asteroidId,
    assignments: group,
    detail: details.value[asteroidId] ?? null,
    totalMiners: group.reduce((sum, assignment) => sum + assignment.assignedAmount, 0),
    recallRequestedAmount: group.reduce(
      (sum, assignment) => sum + assignment.recallRequestedAmount,
      0
    ),
  }));
});

async function loadAll() {
  loading.value = true;
  error.value = null;
  try {
    const [assignmentResponse, fleetResponse, tripResponse] = await Promise.all([
      apiClient.get(`/stations/${props.stationId}/mining-assignments`),
      apiClient.get(`/stations/${props.stationId}/spacecrafts`),
      apiClient.get('/me/trips'),
    ]);
    assignments.value = assignmentResponse.data.assignments;
    fleet.value = fleetResponse.data.spacecrafts;
    trips.value = tripResponse.data;

    const asteroidIds = [...new Set(assignments.value.map((assignment) => assignment.asteroidId))];
    const loaded = await Promise.all(
      asteroidIds.map(async (asteroidId) => {
        const response = await apiClient.get(`/asteroids/${asteroidId}`);
        return [asteroidId, response.data.asteroid] as const;
      })
    );
    details.value = Object.fromEntries(loaded);
  } catch {
    error.value = 'Failed to load mining operations';
  } finally {
    loading.value = false;
  }
}

void loadAll();
const clock = window.setInterval(() => (now.value = Date.now()), 1_000);
const unsubMining = wsClient.on('mining_tick_completed', loadAll);
const unsubTrips = wsClient.on('transport_tick_completed', loadAll);
onUnmounted(() => {
  window.clearInterval(clock);
  unsubMining();
  unsubTrips();
});
</script>

<template>
  <div class="relative flex flex-col flex-1 min-h-0 overflow-hidden">
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <span class="text-[9px] text-cyan-400/40 uppercase tracking-widest animate-pulse">
        Loading operations…
      </span>
    </div>
    <div v-else-if="error" class="flex-1 flex items-center justify-center">
      <span class="text-[9px] text-red-400/60 uppercase tracking-widest">{{ error }}</span>
    </div>
    <div v-else class="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
      <div class="grid grid-cols-2 md:grid-cols-6 gap-1.5">
        <div
          v-for="item in [
            ['Assigned', assignedMiners],
            ['Outbound', outboundMiners],
            ['Mining', miningMiners],
            ['Returning', returningMiners],
            ['Available', availableMiners],
            ['Reserve', remainingReserve.toLocaleString('de-DE')],
          ]"
          :key="String(item[0])"
          class="bg-white/3 border border-white/6 rounded px-2 py-2 flex flex-col gap-1"
        >
          <span class="text-[7px] text-white/25 uppercase tracking-[0.22em]">{{ item[0] }}</span>
          <span class="text-[14px] text-white/75 font-semibold tabular-nums">{{ item[1] }}</span>
        </div>
      </div>

      <div v-if="asteroidRows.length === 0" class="flex-1 flex items-center justify-center">
        <span class="text-[9px] text-white/20 uppercase tracking-widest">
          No mining operations assigned
        </span>
      </div>

      <button
        v-for="row in asteroidRows"
        :key="row.asteroidId"
        class="grid grid-cols-[1fr_auto] gap-4 text-left bg-white/2 border border-white/6 rounded px-3 py-2 hover:bg-white/4 hover:border-cyan-400/20 transition"
        @click="selectedAsteroidId = row.asteroidId"
      >
        <div class="flex flex-col gap-1 min-w-0">
          <div class="flex items-center gap-2">
            <span
              class="w-1.5 h-1.5 rounded-full"
              :style="`background:${resourceColor(row.assignments[0]?.asteroidPrimaryResourceKey ?? null)}`"
            />
            <span class="text-[10px] text-white/70">
              {{ resourceName(row.assignments[0]?.asteroidPrimaryResourceKey ?? 'unknown') }}
            </span>
            <span class="text-[8px] text-white/20">#{{ row.asteroidId.slice(0, 6) }}</span>
            <span v-if="row.recallRequestedAmount" class="text-[8px] text-amber-300/60 uppercase">
              {{ row.recallRequestedAmount }} returning
            </span>
          </div>
          <span class="text-[9px] text-white/30 truncate">
            {{
              row.assignments
                .map(
                  (assignment) =>
                    `${assignment.assignedAmount}× ${assignment.spacecraftName}${
                      assignment.recallRequestedAmount
                        ? ` (${assignment.recallRequestedAmount} returning)`
                        : ''
                    }`
                )
                .join(' · ')
            }}
          </span>
        </div>
        <div class="text-right flex flex-col gap-1">
          <span class="text-[11px] text-white/60 tabular-nums">{{ row.totalMiners }} miners</span>
          <span class="text-[8px] text-white/25 tabular-nums">
            {{
              (row.detail?.veins ?? [])
                .reduce((sum, vein) => sum + vein.remainingAmount, 0)
                .toLocaleString('de-DE')
            }}
            remaining
          </span>
        </div>
      </button>
    </div>

    <AsteroidPanel
      v-if="selectedAsteroidId"
      :asteroid-id="selectedAsteroidId"
      :station-id="stationId"
      @close="selectedAsteroidId = null"
      @refresh="loadAll"
    />
  </div>
</template>
