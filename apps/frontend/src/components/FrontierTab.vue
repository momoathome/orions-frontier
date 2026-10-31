<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { resources } from '@orions-frontier/game-config';
import {
  entriesOf,
  type FrontierResponse,
  type FrontierTarget,
  type KnownSector,
  type WorldMission,
} from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../lib/api-client';
import { formatDuration } from '../lib/format';
import { wsClient } from '../lib/ws-client';
import { useResearchStore } from '../stores/research.js';

const { stationId } = defineProps<{ stationId: string }>();
const research = useResearchStore();
const frontier = ref<FrontierResponse | null>(null);
const sectors = ref<KnownSector[]>([]);
const missions = ref<WorldMission[]>([]);
const colonyName = ref('Frontier Outpost');
const busy = ref(false);
const error = ref<string | null>(null);

const colonizable = computed(() =>
  sectors.value.filter((sector) => sector.role === 'frontier' && !sector.hasOwnStation)
);
const colonizationCostLabel = computed(() =>
  entriesOf(frontier.value?.colonization.cost ?? {})
    .map(([resourceKey, amount]) => `${amount.toLocaleString()} ${resources[resourceKey].name}`)
    .join(', ')
);
// The server enforces both limits; these only explain a disabled button.
const exploreBlocker = computed(() => {
  const expeditions = frontier.value?.expeditions;
  if (!expeditions) return null;
  if (!expeditions.canExplore) return 'research';
  return expeditions.active >= expeditions.limit
    ? `Expedition limit reached (${expeditions.active}/${expeditions.limit})`
    : null;
});
const colonyLimitReached = computed(() => {
  const colonization = frontier.value?.colonization;
  return colonization ? colonization.stations >= colonization.limit : false;
});

const travelTime = (hours: number | null) =>
  hours === null ? 'no ship available' : formatDuration(hours);

async function load() {
  const [frontierResponse, sectorResponse, missionResponse] = await Promise.all([
    apiClient.get<FrontierResponse>('/world/frontier', {
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

const reload = () => {
  void load().catch((cause: unknown) => {
    error.value = apiErrorMessage(cause, 'Frontier data could not be loaded');
  });
};
reload();
const unsubscribers = [
  wsClient.on('world_mission_completed', reload),
  wsClient.on('research_completed', reload),
];
onUnmounted(() => {
  for (const unsubscribe of unsubscribers) unsubscribe();
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-[18px] py-4">
    <section>
      <h3 class="mb-2 text-xs uppercase tracking-[0.28em] text-cyan-300/70">Unknown frontier</h3>
      <p v-if="frontier" class="mb-2 text-xs text-ui-muted">
        Expeditions
        <span class="ui-num text-ui-text"
          >{{ frontier.expeditions.active }}/{{ frontier.expeditions.limit }}</span
        >
      </p>
      <p v-if="exploreBlocker === 'research'" class="mb-2 text-xs text-ui-amber">
        Requires
        <button
          type="button"
          class="text-ui-cyan hover:underline"
          @click="research.openView('long_range_survey')"
        >
          Long-Range Survey</button
        >.
      </p>
      <p v-else-if="exploreBlocker" class="mb-2 text-xs text-ui-amber">{{ exploreBlocker }}</p>
      <div class="space-y-2">
        <div
          v-for="target in frontier?.targets.slice(0, 8) ?? []"
          :key="`${target.sectorX}:${target.sectorY}`"
          class="flex items-center justify-between rounded border border-ui-line bg-white/3 p-2"
        >
          <div>
            <div class="text-xs text-ui-text">? {{ target.sectorX }}, {{ target.sectorY }}</div>
            <div class="text-xs text-ui-muted">{{ travelTime(target.travelHours) }}</div>
          </div>
          <button
            type="button"
            class="rounded border border-cyan-400/25 px-2 py-1 text-xs text-cyan-200 disabled:opacity-30"
            :disabled="busy || exploreBlocker !== null || target.travelHours === null"
            @click="explore(target)"
          >
            Explore
          </button>
        </div>
      </div>
    </section>

    <section>
      <h3 class="mb-2 text-xs uppercase tracking-[0.28em] text-cyan-300/70">Colonization</h3>
      <input
        v-model.trim="colonyName"
        maxlength="128"
        class="mb-2 w-full rounded border border-ui-line-strong bg-white/5 px-2 py-1 text-xs"
      />
      <p class="mb-2 text-xs text-ui-muted">Cost: {{ colonizationCostLabel }}</p>
      <p v-if="frontier" class="mb-2 text-xs text-ui-muted">
        Colonies
        <span class="ui-num text-ui-text"
          >{{ frontier.colonization.stations }}/{{ frontier.colonization.limit }}</span
        >
      </p>
      <p v-if="colonyLimitReached" class="mb-2 text-xs text-ui-amber">
        Colony limit reached. Raise it with
        <button
          type="button"
          class="text-ui-cyan hover:underline"
          @click="research.openView('colony_logistics')"
        >
          Colony Logistics</button
        >.
      </p>
      <div class="space-y-2">
        <div
          v-for="sector in colonizable.slice(0, 8)"
          :key="sector.id"
          class="flex items-center justify-between rounded border border-ui-line bg-white/3 p-2"
        >
          <div>
            <div class="text-xs text-ui-text">
              Sector {{ sector.sectorX }}, {{ sector.sectorY }}
            </div>
            <div class="text-xs text-ui-muted">{{ travelTime(sector.travelHours) }}</div>
          </div>
          <button
            type="button"
            class="rounded border border-amber-400/25 px-2 py-1 text-xs text-amber-200 disabled:opacity-30"
            :disabled="busy || colonyLimitReached || !colonyName || sector.travelHours === null"
            @click="colonize(sector)"
          >
            Colonize
          </button>
        </div>
      </div>
    </section>

    <section>
      <h3 class="mb-2 text-xs uppercase tracking-[0.28em] text-cyan-300/70">Missions</h3>
      <p v-if="error" class="ui-error mb-2">{{ error }}</p>
      <div class="space-y-2">
        <div
          v-for="mission in missions.slice(0, 10)"
          :key="mission.id"
          class="rounded border border-ui-line bg-white/3 p-2"
        >
          <div class="flex justify-between text-xs text-ui-text">
            <span>{{ mission.missionType }}</span
            ><span>{{ mission.status }}</span>
          </div>
          <div class="text-xs text-ui-muted">
            {{ mission.spacecraftName }} → {{ mission.targetSectorX }}, {{ mission.targetSectorY }}
          </div>
        </div>
        <p v-if="missions.length === 0" class="text-xs text-ui-dim">No missions yet.</p>
      </div>
    </section>
  </div>
</template>
