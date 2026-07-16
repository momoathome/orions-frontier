<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import type { StationSpacecraftWithDefinition } from '@orions-frontier/shared';
import { apiClient } from '../lib/api-client';
import { ALL_RESOURCES, formatBuildTime } from '../lib/spacecraft-utils';

const props = defineProps<{
  stationId: string;
  ship: StationSpacecraftWithDefinition;
}>();

const emit = defineEmits<{ built: [] }>();

const buildAmount = ref(1);
const buildSubmitting = ref(false);
const buildError = ref<string | null>(null);
const buildSuccess = ref(false);
const playerResources = ref<Record<string, number>>({});

async function fetchPlayerResources() {
  try {
    const { data } = await apiClient.get<{
      success: true;
      data: { resources: Record<string, number> };
    }>('/me/resources');
    playerResources.value = data.data.resources;
  } catch {
    // silently ignore – Max button simply won't work without fresh data
  }
}

onMounted(() => fetchPlayerResources());

// Reset state when selected ship changes
watch(
  () => props.ship,
  () => {
    buildError.value = null;
    buildSuccess.value = false;
    fetchPlayerResources();
  }
);

function setMaxAmount() {
  const costs = props.ship.definition.costs;
  if (costs.length === 0) return;
  const max = Math.min(
    ...costs.map((c) => {
      const have = playerResources.value[c.resourceKey] ?? 0;
      return c.amount > 0 ? Math.floor(have / c.amount) : Infinity;
    })
  );
  buildAmount.value = Math.max(1, isFinite(max) ? max : 1);
}

function costFor(resourceKey: string): number {
  return props.ship.definition.costs.find((c) => c.resourceKey === resourceKey)?.amount ?? 0;
}

async function submitBuild() {
  if (buildSubmitting.value || (buildAmount.value || 0) < 1) return;
  buildSubmitting.value = true;
  buildError.value = null;
  buildSuccess.value = false;
  try {
    await apiClient.post(`/stations/${props.stationId}/spacecrafts/build`, {
      orders: [{ spacecraftKey: props.ship.definition.key, amount: Math.floor(buildAmount.value) }],
    });
    buildSuccess.value = true;
    emit('built');
    setTimeout(() => {
      buildSuccess.value = false;
    }, 3000);
  } catch (err: any) {
    buildError.value = err?.response?.data?.message ?? 'Build order failed';
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
          @click="buildAmount = Math.max(1, buildAmount - 1)"
          class="w-7 h-7 flex items-center justify-center rounded border border-white/10 text-white/50 hover:bg-white/8 hover:text-white/80 transition"
        >
          −
        </button>
        <input
          v-model.number="buildAmount"
          type="number"
          min="1"
          step="1"
          @change="buildAmount = Math.max(1, Math.floor(buildAmount || 1))"
          class="w-14 h-7 text-center text-[12px] text-white/80 bg-white/5 border border-white/12 rounded tabular-nums focus:outline-none focus:border-cyan-500/50"
        />
        <button
          @click="buildAmount = buildAmount + 1"
          class="w-7 h-7 flex items-center justify-center rounded border border-white/10 text-white/50 hover:bg-white/8 hover:text-white/80 transition"
        >
          +
        </button>
        <button
          @click="setMaxAmount"
          class="px-2 h-7 flex items-center justify-center rounded border border-white/10 text-white/35 hover:bg-white/8 hover:text-white/70 transition text-[9px] uppercase tracking-widest"
        >
          Max
        </button>
      </div>
    </div>

    <!-- Total costs -->
    <div class="flex flex-col gap-1.5">
      <span class="text-[9px] text-white/20 uppercase tracking-widest">Total</span>
      <div class="flex items-center gap-x-6">
        <div v-for="res in ALL_RESOURCES" :key="res" class="flex items-center gap-1.5 h-6">
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
      <button
        @click="submitBuild"
        :disabled="buildSubmitting || (buildAmount || 0) < 1"
        class="px-6 h-8 rounded border text-[10px] uppercase tracking-[0.2em] font-semibold transition"
        :class="
          buildSuccess
            ? 'border-green-500/40 bg-green-500/10 text-green-300'
            : buildSubmitting || (buildAmount || 0) < 1
              ? 'border-white/10 bg-white/3 text-white/25 cursor-not-allowed'
              : 'border-cyan-500/40 bg-cyan-500/9 hover:bg-cyan-500/20 text-cyan-200'
        "
      >
        <span v-if="buildSuccess">Queued ✓</span>
        <span v-else-if="buildSubmitting">Submitting…</span>
        <span v-else>Build</span>
      </button>
      <p v-if="buildError" class="text-[9px] text-rose-400/70">{{ buildError }}</p>
    </div>
  </div>
</template>
