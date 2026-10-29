<script setup lang="ts">
import type { StationSpacecraftsResponse } from '@orions-frontier/shared';
import { computed, onUnmounted, ref } from 'vue';
import { getMiningTripPhase, type StationSpacecraftWithDefinition } from '@orions-frontier/shared';
import { apiClient } from '../lib/api-client';
import { wsClient } from '../lib/ws-client';
import { debounced } from '../lib/debounce';
import { resourceColor, resourceName } from '../lib/mining-utils';
import AsteroidPanel from './AsteroidPanel.vue';

interface MiningAssignment {
  id: string;
  asteroidId: string;
  asteroidX: number;
  asteroidY: number;
  asteroidPrimaryResourceKey: string | null;
  asteroidRemainingAmount: number;
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

const { stationId } = defineProps<{ stationId: string }>();
const assignments = ref<MiningAssignment[]>([]);
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
  trips.value.filter((trip) => trip.fromId === stationId || trip.toId === stationId)
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
    totalMiners: group.reduce((sum, assignment) => sum + assignment.assignedAmount, 0),
    recallRequestedAmount: group.reduce(
      (sum, assignment) => sum + assignment.recallRequestedAmount,
      0
    ),
    summary: group
      .map(
        (assignment) =>
          `${assignment.assignedAmount}× ${assignment.spacecraftName}${
            assignment.recallRequestedAmount
              ? ` (${assignment.recallRequestedAmount} returning)`
              : ''
          }`
      )
      .join(' · '),
    remainingAmount: group[0]?.asteroidRemainingAmount ?? 0,
  }));
});
const remainingReserve = computed(() =>
  asteroidRows.value.reduce((sum, row) => sum + row.remainingAmount, 0)
);

async function loadAll(showLoading = true) {
  if (showLoading) loading.value = true;
  error.value = null;
  try {
    const [assignmentResponse, fleetResponse, tripResponse] = await Promise.all([
      apiClient.get<{ assignments: MiningAssignment[] }>(
        `/stations/${stationId}/mining-assignments`
      ),
      apiClient.get<StationSpacecraftsResponse>(`/stations/${stationId}/spacecrafts`),
      apiClient.get<Trip[]>('/me/trips'),
    ]);
    assignments.value = assignmentResponse.assignments;
    fleet.value = fleetResponse.spacecrafts;
    trips.value = tripResponse;
  } catch {
    error.value = 'Failed to load mining operations';
  } finally {
    loading.value = false;
  }
}

void loadAll();
const clock = window.setInterval(() => (now.value = Date.now()), 1_000);
// Background reloads keep the list on screen instead of the loading state.
const reload = debounced(() => loadAll(false), 500);
const unsubMining = wsClient.on('mining_tick_completed', reload);
const unsubTrips = wsClient.on('transport_tick_completed', reload);
onUnmounted(() => {
  reload.cancel();
  window.clearInterval(clock);
  unsubMining();
  unsubTrips();
});
</script>

<template>
  <div class="relative flex flex-col flex-1 min-h-0 overflow-hidden">
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <span class="text-xs text-cyan-400/40 uppercase tracking-[0.08em] animate-pulse">
        Loading operations…
      </span>
    </div>
    <div v-else-if="error" class="flex-1 flex items-center justify-center">
      <span class="text-xs text-red-400/60 uppercase tracking-[0.08em]">{{ error }}</span>
    </div>
    <div v-else class="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
      <div class="grid grid-cols-3 gap-1.5">
        <div
          v-for="item in [
            ['Assigned', assignedMiners],
            ['Outbound', outboundMiners],
            ['Mining', miningMiners],
            ['Returning', returningMiners],
            ['Available', availableMiners],
            ['Reserve', remainingReserve.toLocaleString('en-US')],
          ]"
          :key="String(item[0])"
          class="bg-white/3 border border-ui-line rounded px-2 py-2 flex flex-col gap-1"
        >
          <span class="text-xs text-ui-dim uppercase tracking-[0.22em]">{{ item[0] }}</span>
          <span class="text-[14px] text-ui-text font-semibold tabular-nums">{{ item[1] }}</span>
        </div>
      </div>

      <div v-if="asteroidRows.length === 0" class="flex-1 flex items-center justify-center">
        <span class="text-xs text-ui-dim uppercase tracking-[0.08em]">
          No mining operations assigned
        </span>
      </div>

      <button
        v-for="row in asteroidRows"
        :key="row.asteroidId"
        type="button"
        class="grid grid-cols-[1fr_auto] gap-4 text-left bg-white/2 border border-ui-line rounded px-3 py-2 hover:bg-white/4 hover:border-cyan-400/20 transition"
        @click="selectedAsteroidId = row.asteroidId"
      >
        <div class="flex flex-col gap-1 min-w-0">
          <div class="flex items-center gap-2">
            <span
              class="w-1.5 h-1.5 rounded-full"
              :style="`background:${resourceColor(row.assignments[0]?.asteroidPrimaryResourceKey ?? null)}`"
            />
            <span class="text-xs text-ui-text">
              {{ resourceName(row.assignments[0]?.asteroidPrimaryResourceKey ?? 'unknown') }}
            </span>
            <span class="text-xs text-ui-dim">#{{ row.asteroidId.slice(0, 6) }}</span>
            <span v-if="row.recallRequestedAmount" class="text-xs text-amber-300/60 uppercase">
              {{ row.recallRequestedAmount }} returning
            </span>
          </div>
          <span class="text-xs text-ui-muted truncate">
            {{ row.summary }}
          </span>
        </div>
        <div class="text-right flex flex-col gap-1">
          <span class="text-[13px] text-ui-soft tabular-nums">{{ row.totalMiners }} miners</span>
          <span class="text-xs text-ui-dim tabular-nums">
            {{ row.remainingAmount.toLocaleString('en-US') }}
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
      @refresh="reload"
    />
  </div>
</template>
