<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import type { ResearchState, StationResearch } from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../lib/api-client';

const props = defineProps<{ stationId: string }>();
const state = ref<ResearchState | null>(null);
const error = ref<string | null>(null);
const starting = ref<string | null>(null);
const now = ref(Date.now());

async function load(): Promise<void> {
  try {
    const response = await apiClient.get(`/stations/${props.stationId}/research`);
    state.value = response;
    error.value = null;
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Research could not be loaded');
  }
}

async function start(technology: StationResearch): Promise<void> {
  starting.value = technology.key;
  try {
    await apiClient.post(`/stations/${props.stationId}/research/${technology.key}`);
    await load();
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Research could not be started');
  } finally {
    starting.value = null;
  }
}

const availablePoints = computed(() => (state.value?.capacity ?? 0) - (state.value?.used ?? 0));
const remaining = (technology: StationResearch): string => {
  if (!technology.completesAt) return '';
  const seconds = Math.max(
    0,
    Math.ceil((new Date(technology.completesAt).getTime() - now.value) / 1000)
  );
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

void load();
const interval = setInterval(() => {
  now.value = Date.now();
  if (state.value?.technologies.some((technology) => technology.status === 'researching')) {
    void load();
  }
}, 5_000);
onUnmounted(() => clearInterval(interval));
</script>

<template>
  <div class="flex h-full flex-col gap-3 overflow-y-auto p-4 font-mono text-[10px]">
    <div class="flex items-center justify-between border-b border-white/5 pb-3">
      <span class="uppercase tracking-[0.3em] text-green-300/60">Laboratory research</span>
      <span class="text-white/45">Points {{ state?.used ?? 0 }}/{{ state?.capacity ?? 0 }}</span>
    </div>
    <p v-if="error" class="text-rose-300/70">{{ error }}</p>
    <div
      v-for="technology in state?.technologies ?? []"
      :key="technology.key"
      class="grid grid-cols-[1fr_auto] gap-5 rounded border border-white/7 bg-white/[0.02] p-3"
    >
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-3">
          <span class="text-sm text-white/85">{{ technology.name }}</span>
          <span class="uppercase tracking-widest text-green-300/50">{{ technology.status }}</span>
        </div>
        <p class="text-white/35">{{ technology.description }}</p>
        <div class="flex gap-4 text-white/45">
          <span>{{ technology.points }} research points</span>
          <span>{{ technology.duration }}s</span>
          <span v-for="cost in technology.costs" :key="cost.resourceKey">
            {{ cost.amount }} {{ cost.resourceKey }}
          </span>
        </div>
      </div>
      <button
        v-if="technology.status === 'available'"
        :disabled="starting !== null || availablePoints < technology.points"
        class="self-end rounded border border-green-400/30 px-4 py-2 uppercase tracking-widest text-green-200 disabled:opacity-30"
        @click="start(technology)"
      >
        {{ starting === technology.key ? 'Starting…' : 'Research' }}
      </button>
      <span v-else-if="technology.status === 'researching'" class="self-end text-amber-300">
        {{ remaining(technology) }}
      </span>
      <span v-else class="self-end text-green-300">Active</span>
    </div>
  </div>
</template>
