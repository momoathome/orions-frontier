<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { calculateColonizationCost, resources } from '@orions-frontier/game-config';
import {
  entriesOf,
  type KnownSector,
  type FrontierTarget,
  type WorldMission,
} from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../lib/api-client';
import { wsClient } from '../lib/ws-client';

const { stationId } = defineProps<{ stationId: string }>();
const frontier = ref<FrontierTarget[]>([]);
const sectors = ref<KnownSector[]>([]);
const missions = ref<WorldMission[]>([]);
const colonyName = ref('Frontier Outpost');
const busy = ref(false);
const error = ref<string | null>(null);
let unsubscribe: (() => void) | null = null;

const colonizable = computed(() =>
  sectors.value.filter((sector) => sector.role === 'frontier' && !sector.hasOwnStation)
);
// Each own station sits in its own sector, so this counts the stations the cost scales with.
const colonizationCostLabel = computed(() =>
  entriesOf(
    calculateColonizationCost(sectors.value.filter((sector) => sector.hasOwnStation).length)
  )
    .map(([resourceKey, amount]) => `${amount.toLocaleString()} ${resources[resourceKey].name}`)
    .join(' · ')
);

const formatDuration = (hours: number | null) => {
  if (hours === null) return 'no ship available';
  const minutes = Math.round(hours * 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

async function load() {
  const [frontierResponse, sectorResponse, missionResponse] = await Promise.all([
    apiClient.get<FrontierTarget[]>('/world/frontier', {
      params: { stationId },
    }),
    apiClient.get<KnownSector[]>('/world/sectors', {
      params: { stationId },
    }),
    apiClient.get<WorldMission[]>('/me/world-missions'),
  ]);
  frontier.value = frontierResponse;
  sectors.value = sectorResponse;
  missions.value = missionResponse;
}

async function run(action: () => Promise<unknown>) {
  busy.value = true;
  error.value = null;
  try {
    await action();
    await load();
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Mission could not be started');
  } finally {
    busy.value = false;
  }
}

const explore = (target: FrontierTarget) =>
  run(() =>
    apiClient.post(`/stations/${stationId}/expeditions`, {
      sectorX: target.sectorX,
      sectorY: target.sectorY,
    })
  );

const colonize = (target: KnownSector) =>
  run(() =>
    apiClient.post(`/stations/${stationId}/colonies`, {
      sectorX: target.sectorX,
      sectorY: target.sectorY,
      name: colonyName.value,
    })
  );

onMounted(async () => {
  try {
    await load();
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Frontier data could not be loaded');
  }
  unsubscribe = wsClient.on('world_mission_completed', () => {
    void load().catch((cause: unknown) => {
      error.value = apiErrorMessage(cause, 'Frontier data could not be loaded');
    });
  });
});

onUnmounted(() => unsubscribe?.());
</script>

<template>
  <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 md:grid-cols-3">
    <section>
      <h3 class="mb-2 text-[9px] uppercase tracking-[0.28em] text-cyan-300/70">Unknown frontier</h3>
      <div class="space-y-2">
        <div
          v-for="target in frontier.slice(0, 8)"
          :key="`${target.sectorX}:${target.sectorY}`"
          class="flex items-center justify-between rounded border border-white/8 bg-white/3 p-2"
        >
          <div>
            <div class="text-xs text-white/75">? {{ target.sectorX }}, {{ target.sectorY }}</div>
            <div class="text-[9px] text-white/35">{{ formatDuration(target.travelHours) }}</div>
          </div>
          <button
            type="button"
            class="rounded border border-cyan-400/25 px-2 py-1 text-[9px] text-cyan-200 disabled:opacity-30"
            :disabled="busy || target.travelHours === null"
            @click="explore(target)"
          >
            Explore
          </button>
        </div>
      </div>
    </section>

    <section>
      <h3 class="mb-2 text-[9px] uppercase tracking-[0.28em] text-cyan-300/70">Colonization</h3>
      <input
        v-model.trim="colonyName"
        maxlength="128"
        class="mb-2 w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs"
      />
      <p class="mb-2 text-[9px] text-white/35">Cost: {{ colonizationCostLabel }}</p>
      <div class="space-y-2">
        <div
          v-for="sector in colonizable.slice(0, 8)"
          :key="sector.id"
          class="flex items-center justify-between rounded border border-white/8 bg-white/3 p-2"
        >
          <div>
            <div class="text-xs text-white/75">
              Sector {{ sector.sectorX }}, {{ sector.sectorY }}
            </div>
            <div class="text-[9px] text-white/35">{{ formatDuration(sector.travelHours) }}</div>
          </div>
          <button
            type="button"
            class="rounded border border-amber-400/25 px-2 py-1 text-[9px] text-amber-200 disabled:opacity-30"
            :disabled="busy || !colonyName || sector.travelHours === null"
            @click="colonize(sector)"
          >
            Colonize
          </button>
        </div>
      </div>
    </section>

    <section>
      <h3 class="mb-2 text-[9px] uppercase tracking-[0.28em] text-cyan-300/70">Missions</h3>
      <p v-if="error" class="mb-2 text-[10px] text-red-300">{{ error }}</p>
      <div class="space-y-2">
        <div
          v-for="mission in missions.slice(0, 10)"
          :key="mission.id"
          class="rounded border border-white/8 bg-white/3 p-2"
        >
          <div class="flex justify-between text-[10px] text-white/70">
            <span>{{ mission.missionType }}</span
            ><span>{{ mission.status }}</span>
          </div>
          <div class="text-[9px] text-white/35">
            {{ mission.spacecraftName }} → {{ mission.targetSectorX }}, {{ mission.targetSectorY }}
          </div>
        </div>
        <p v-if="missions.length === 0" class="text-[10px] text-white/25">No missions yet.</p>
      </div>
    </section>
  </div>
</template>
