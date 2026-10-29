<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import {
  getCostShortfall,
  type ResearchState,
  type StationResearch,
} from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../lib/api-client';
import { formatBuildTime, formatCountdown, formatShortfall } from '../lib/format';
import { useOverviewStore } from '../stores/overview.js';
import CostList from './CostList.vue';

const { stationId } = defineProps<{ stationId: string }>();
const overview = useOverviewStore();
const state = ref<ResearchState | null>(null);
const error = ref<string | null>(null);
const starting = ref<string | null>(null);
const now = computed(() => overview.state.now);
const stock = computed(() => overview.state.details[stationId]?.resources ?? null);

async function load(): Promise<void> {
  try {
    state.value = await apiClient.get<ResearchState>(`/stations/${stationId}/research`);
    error.value = null;
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Research could not be loaded');
  }
}

const availablePoints = computed(() => (state.value?.capacity ?? 0) - (state.value?.used ?? 0));

// Same card shape as BuildingsTab, in research green.
const cards = computed(() =>
  (state.value?.technologies ?? []).map((technology) => {
    const shortfall = getCostShortfall(
      technology.costs,
      stock.value?.resources ?? {},
      stock.value?.rates ?? {}
    );
    const endsAt = technology.completesAt ? Date.parse(technology.completesAt) : null;
    const durationMs = technology.duration * 1_000;
    const hasCapacity = availablePoints.value >= technology.points;
    const canStart =
      technology.status === 'available' && hasCapacity && shortfall.missing.length === 0;
    return {
      technology,
      canStart,
      endsAt,
      accent: canStart ? 'border-green-400/30' : '',
      progress:
        endsAt && durationMs > 0
          ? Math.min(100, Math.max(0, 100 - ((endsAt - now.value) / durationMs) * 100))
          : 0,
      buildTime: formatBuildTime(technology.duration),
      blocker: hasCapacity
        ? formatShortfall(shortfall)
        : `Needs ${technology.points} free research points, ${availablePoints.value} left`,
    };
  })
);

async function start(technology: StationResearch): Promise<void> {
  if (starting.value !== null) return;
  starting.value = technology.key;
  try {
    await apiClient.post(`/stations/${stationId}/research/${technology.key}`);
    await Promise.all([load(), overview.refreshStation(stationId)]);
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Research could not be started');
  } finally {
    starting.value = null;
  }
}

void load();
const interval = setInterval(() => {
  if (state.value?.technologies.some((technology) => technology.status === 'researching')) {
    void load();
  }
}, 5_000);
onUnmounted(() => {
  clearInterval(interval);
});
</script>

<template>
  <div class="flex flex-col gap-2.5 overflow-y-auto px-[18px] py-3.5 text-sm">
    <div class="ui-card flex-row items-center justify-between border-green-400/15 bg-green-500/5">
      <span class="ui-label text-green-300/70">Research points</span>
      <span class="ui-num text-[22px] font-semibold text-green-200">
        {{ state?.used ?? 0
        }}<span class="text-sm font-normal text-ui-dim"> / {{ state?.capacity ?? 0 }}</span>
      </span>
    </div>
    <p v-if="error" class="rounded-md border border-[#6b2f2c] bg-[#2a1214] px-3 py-2 text-ui-red">
      {{ error }}
    </p>
    <p v-if="!state && !error" class="animate-pulse text-ui-muted">Loading research…</p>

    <article v-for="card in cards" :key="card.technology.key" class="ui-card" :class="card.accent">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-base font-semibold text-ui-bright">{{ card.technology.name }}</h3>
        <span
          v-if="card.technology.status === 'researching'"
          class="rounded bg-[#2a200b] px-2 py-0.5 text-xs text-ui-amber"
          >Researching</span
        >
        <span
          v-else-if="card.technology.status === 'completed'"
          class="rounded bg-green-500/10 px-2 py-0.5 text-xs text-green-300"
          >Active</span
        >
        <span
          v-else-if="card.canStart"
          class="rounded bg-green-500/10 px-2 py-0.5 text-xs text-green-200"
          >Available</span
        >
        <span v-else class="rounded bg-[#141d2c] px-2 py-0.5 text-xs text-ui-muted">Saving</span>
      </div>

      <p class="text-[13px] text-ui-muted">{{ card.technology.description }}</p>

      <div class="flex items-baseline gap-2 text-[13px] text-ui-soft">
        <span>Research points</span>
        <span class="ui-num text-green-200">{{ card.technology.points }}</span>
      </div>

      <div
        v-if="card.technology.status === 'researching' && card.endsAt"
        class="flex flex-col gap-1.5"
      >
        <div class="ui-bar">
          <div
            class="h-full rounded-full bg-ui-amber transition-[width] duration-1000 ease-linear"
            :style="{ width: `${card.progress}%` }"
          />
        </div>
        <span class="text-[13px] text-ui-soft">
          Done in
          <strong class="ui-num text-ui-amber">{{ formatCountdown(card.endsAt, now) }}</strong>
        </span>
      </div>

      <template v-else-if="card.technology.status === 'available'">
        <div class="flex items-center justify-between gap-3">
          <CostList
            :costs="card.technology.costs"
            :stock="stock?.resources"
            :duration="card.buildTime"
          />
          <button
            type="button"
            class="ui-btn"
            :class="{
              'border-green-400/30 bg-green-500/10 text-green-200 hover:bg-green-500/20':
                card.canStart,
            }"
            :disabled="!card.canStart || starting !== null"
            @click="start(card.technology)"
          >
            {{ starting === card.technology.key ? 'Starting…' : 'Research' }}
          </button>
        </div>
        <span v-if="card.blocker" class="text-xs text-ui-amber">{{ card.blocker }}</span>
      </template>
    </article>
  </div>
</template>
