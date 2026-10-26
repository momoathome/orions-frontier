<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue';
import {
  resourceKeys,
  type StationSpacecraftWithDefinition,
  type UserResourceSummary,
} from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../lib/api-client';
import { formatBuildTime } from '../lib/spacecraft-utils';

const { hangar, ship, stationId } = defineProps<{
  stationId: string;
  ship: StationSpacecraftWithDefinition;
  hangar: { used: number; capacity: number };
}>();

const emit = defineEmits<{ built: [] }>();

const buildAmount = ref(1);
const buildSubmitting = ref(false);
const buildError = ref<string | null>(null);
const buildSuccess = ref(false);
const playerResources = ref<Record<string, number> | null>(null);

async function fetchPlayerResources() {
  try {
    const response = await apiClient.get<UserResourceSummary>('/me/resources', {
      params: { stationId: stationId },
    });
    playerResources.value = response.resources;
  } catch {
    // silently ignore – Max button simply won't work without fresh data
  }
}

onMounted(() => fetchPlayerResources());

// Reset state when selected ship changes
watch(
  () => ship,
  () => {
    buildError.value = null;
    buildSuccess.value = false;
    void fetchPlayerResources();
  }
);

const maxBuildable = computed(() => {
  const resourceMaximum = Math.min(
    ...ship.definition.costs.map((cost) =>
      cost.amount > 0
        ? Math.floor((playerResources.value?.[cost.resourceKey] ?? 0) / cost.amount)
        : Infinity
    )
  );
  const crewMaximum = Math.floor(Math.max(0, hangar.capacity - hangar.used) / ship.definition.crew);
  return Math.max(0, Math.min(resourceMaximum, crewMaximum));
});

const hasValidAmount = computed(
  () => Number.isInteger(buildAmount.value) && buildAmount.value >= 1
);
const exceedsCapacity = computed(
  () =>
    hasValidAmount.value && hangar.used + ship.definition.crew * buildAmount.value > hangar.capacity
);
const lacksResources = computed(
  () =>
    playerResources.value !== null &&
    hasValidAmount.value &&
    ship.definition.costs.some(
      (cost) => (playerResources.value?.[cost.resourceKey] ?? 0) < cost.amount * buildAmount.value
    )
);
const canSubmit = computed(
  () =>
    !buildSubmitting.value &&
    playerResources.value !== null &&
    hasValidAmount.value &&
    !exceedsCapacity.value &&
    !lacksResources.value
);

const submitClass = computed(() => {
  if (buildSuccess.value) return 'border-green-500/40 bg-green-500/10 text-green-300';
  if (!canSubmit.value) return 'border-white/10 bg-white/3 text-white/25 cursor-not-allowed';
  return 'border-cyan-500/40 bg-cyan-500/9 hover:bg-cyan-500/20 text-cyan-200';
});

function setMaxAmount() {
  buildAmount.value = Math.max(1, maxBuildable.value);
}

function costFor(resourceKey: string): number {
  return ship.definition.costs.find((c) => c.resourceKey === resourceKey)?.amount ?? 0;
}

async function submitBuild() {
  if (!canSubmit.value) return;
  buildSubmitting.value = true;
  buildError.value = null;
  buildSuccess.value = false;
  try {
    await apiClient.post(`/stations/${stationId}/spacecrafts/build`, {
      orders: [{ spacecraftKey: ship.definition.key, amount: Math.floor(buildAmount.value) }],
    });
    buildSuccess.value = true;
    emit('built');
    setTimeout(() => {
      buildSuccess.value = false;
    }, 3000);
  } catch (error) {
    buildError.value = apiErrorMessage(error, 'Build order failed');
    setTimeout(() => {
      buildError.value = null;
    }, 4000);
  } finally {
    buildSubmitting.value = false;
  }
}
</script>

<template>
  <div class="pt-3 grid grid-cols-[auto_1fr_auto] items-end gap-5">
    <!-- Amount -->
    <div class="flex flex-col gap-1.5">
      <span class="text-[9px] text-white/20 uppercase tracking-widest">Amount</span>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="w-7 h-7 flex items-center justify-center rounded border border-white/10 text-white/50 hover:bg-white/8 hover:text-white/80 transition"
          @click="buildAmount = Math.max(1, buildAmount - 1)"
        >
          −
        </button>
        <input
          v-model.number="buildAmount"
          type="number"
          min="1"
          step="1"
          class="w-14 h-7 text-center text-[12px] text-white/80 bg-white/5 border border-white/12 rounded tabular-nums focus:outline-none focus:border-cyan-500/50"
          @change="buildAmount = Math.max(1, Math.floor(buildAmount || 1))"
        />
        <button
          type="button"
          class="w-7 h-7 flex items-center justify-center rounded border border-white/10 text-white/50 hover:bg-white/8 hover:text-white/80 transition"
          @click="buildAmount = buildAmount + 1"
        >
          +
        </button>
        <button
          type="button"
          class="px-2 h-7 flex items-center justify-center rounded border border-white/10 text-white/35 hover:bg-white/8 hover:text-white/70 transition text-[9px] uppercase tracking-widest"
          @click="setMaxAmount"
        >
          Max
        </button>
      </div>
    </div>

    <!-- Total costs -->
    <div class="flex flex-col gap-1.5">
      <span class="text-[9px] text-white/20 uppercase tracking-widest">Total</span>
      <div class="flex items-center gap-x-6">
        <div v-for="res in resourceKeys" :key="res" class="flex items-center gap-1.5 h-6">
          <img
            :src="`/assets/resources/${res}.png`"
            :alt="res"
            class="w-3.5 h-3.5 object-contain shrink-0"
            :class="costFor(res) > 0 ? 'opacity-75' : 'opacity-15'"
          />
          <span
            class="text-[11px] tabular-nums font-medium"
            :class="costFor(res) > 0 ? 'text-white/65' : 'text-white/12'"
            >{{
              costFor(res) > 0 ? (costFor(res) * (buildAmount || 1)).toLocaleString() : '—'
            }}</span
          >
        </div>
        <div class="flex items-center gap-1.5 h-6">
          <span class="text-[13px] text-white/25 leading-none">⏱</span>
          <span class="text-[11px] text-white/50 tabular-nums">{{
            formatBuildTime(ship.definition.buildTime * (buildAmount || 1))
          }}</span>
        </div>
      </div>
    </div>

    <!-- Build button -->
    <div class="flex flex-col gap-1 items-end">
      <span class="text-[9px] text-white/30 tabular-nums">
        Crew {{ ship.definition.crew * (buildAmount || 1) }} · Hangar {{ hangar.used }}/{{
          hangar.capacity
        }}
      </span>
      <button
        type="button"
        :disabled="!canSubmit"
        class="px-6 h-8 rounded border text-[10px] uppercase tracking-[0.2em] font-semibold transition"
        :class="submitClass"
        @click="submitBuild"
      >
        <span v-if="buildSuccess">Queued ✓</span>
        <span v-else-if="buildSubmitting">Submitting…</span>
        <span v-else-if="playerResources === null">Loading…</span>
        <span v-else-if="exceedsCapacity">No capacity</span>
        <span v-else-if="lacksResources">Insufficient resources</span>
        <span v-else>Build</span>
      </button>
      <p v-if="buildError" class="text-[9px] text-rose-400/70">{{ buildError }}</p>
    </div>
  </div>
</template>
