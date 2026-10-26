<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { apiClient, apiErrorMessage } from '../lib/api-client';
import type {
  MiningCycleEstimate,
  StationSpacecraftsResponse,
  StationSpacecraftWithDefinition,
} from '@orions-frontier/shared';

const { asteroidId, stationId } = defineProps<{
  asteroidId: string;
  stationId: string;
}>();

const emit = defineEmits<{
  cancel: [];
  done: [];
}>();

const miners = ref<StationSpacecraftWithDefinition[] | null>(null);
const selectedSpacecraftKey = ref('');
const assignAmount = ref(1);
const assignError = ref<string | null>(null);
const assigning = ref(false);
const previewLoading = ref(false);
const previewError = ref<string | null>(null);

/** Reserve fields are null for unscanned asteroids (blind mining). */
type MiningPreview = Omit<MiningCycleEstimate, 'estimatedDepletionHours' | 'finalBatchAmount'> & {
  distance: number;
  remainingAmount: number | null;
  estimatedDepletionHours: number | null;
  finalBatchAmount: number | null;
};
const preview = ref<MiningPreview | null>(null);

async function loadMiners() {
  try {
    const response = await apiClient.get<StationSpacecraftsResponse>(
      `/stations/${stationId}/spacecrafts`
    );
    miners.value = response.spacecrafts.filter(
      (s) =>
        s.definition.role === 'miner' &&
        s.definition.miningRate > 0 &&
        s.amount - s.lockedAmount > 0
    );
    selectedSpacecraftKey.value = miners.value[0]?.definition.key ?? '';
  } catch (error) {
    miners.value = [];
    assignError.value = apiErrorMessage(error, 'Hangar could not be loaded');
  }
}
void loadMiners();

const selectedMiner = computed(
  () => miners.value?.find((m) => m.definition.key === selectedSpacecraftKey.value) ?? null
);
const availableAmount = computed(() =>
  selectedMiner.value ? selectedMiner.value.amount - selectedMiner.value.lockedAmount : 0
);

const submitLabel = computed(() => {
  if (assigning.value) return 'Assigning…';
  return `Assign ${assignAmount.value} ${assignAmount.value === 1 ? 'miner' : 'miners'}`;
});

let previewRequest = 0;
watch(
  [selectedSpacecraftKey, assignAmount],
  async ([spacecraftKey, minerCount]) => {
    const requestId = ++previewRequest;
    preview.value = null;
    previewError.value = null;
    if (!spacecraftKey || minerCount < 1) return;

    previewLoading.value = true;
    try {
      const response = await apiClient.get<MiningPreview>(
        `/asteroids/${asteroidId}/mining-preview`,
        { params: { stationId, spacecraftKey, minerCount } }
      );
      if (requestId === previewRequest) preview.value = response;
    } catch (error) {
      if (requestId === previewRequest) {
        previewError.value = apiErrorMessage(error, 'Preview unavailable');
      }
    } finally {
      if (requestId === previewRequest) previewLoading.value = false;
    }
  },
  { flush: 'post' }
);

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value);
}

async function submit() {
  if (!selectedSpacecraftKey.value) return;
  if (assignAmount.value < 1 || assignAmount.value > availableAmount.value) {
    assignError.value = `Only ${availableAmount.value} ${selectedMiner.value?.definition.name ?? 'spacecraft'} available.`;
    return;
  }
  assigning.value = true;
  assignError.value = null;
  try {
    await apiClient.post(`/asteroids/${asteroidId}/assignments`, {
      stationId,
      spacecraftKey: selectedSpacecraftKey.value,
      assignedAmount: assignAmount.value,
    });
    emit('done');
  } catch (error) {
    assignError.value = apiErrorMessage(error, 'Assignment failed');
  } finally {
    assigning.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <span class="text-[10px] text-cyan-300/70 uppercase tracking-[0.18em]">Assign miners</span>
      <button
        type="button"
        class="text-[10px] text-white/45 hover:text-white/80 uppercase tracking-wider"
        @click="emit('cancel')"
      >
        Back
      </button>
    </div>

    <span v-if="miners === null" class="text-[11px] text-white/45 animate-pulse">
      Loading hangar…
    </span>
    <div v-else-if="miners.length === 0" class="text-[12px] text-white/45 py-3">
      No idle mining spacecraft at this station
    </div>

    <template v-else>
      <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
        <label class="flex flex-col gap-1.5">
          <span class="text-[10px] text-white/45 uppercase tracking-wide">Spacecraft</span>
          <select
            v-model="selectedSpacecraftKey"
            class="bg-white/5 border border-white/10 rounded px-2 h-8 text-[12px] text-white/85 focus:outline-none focus:border-cyan-400/40"
          >
            <option v-for="m in miners" :key="m.definition.key" :value="m.definition.key">
              {{ m.definition.name }} (×{{ m.amount - m.lockedAmount }} idle)
            </option>
          </select>
        </label>

        <div class="flex flex-col gap-1.5">
          <span class="text-[10px] text-white/45 uppercase tracking-wide">Amount</span>
          <div class="flex items-center gap-1">
            <button
              type="button"
              aria-label="Fewer miners"
              class="w-8 h-8 flex items-center justify-center rounded border border-white/10 text-white/60 hover:bg-white/8 hover:text-white/90 transition text-[14px]"
              @click="assignAmount = Math.max(1, assignAmount - 1)"
            >
              −
            </button>
            <input
              v-model.number="assignAmount"
              type="number"
              min="1"
              step="1"
              :max="availableAmount"
              aria-label="Miner amount"
              class="w-14 h-8 text-center text-[13px] text-white/85 bg-white/5 border border-white/12 rounded tabular-nums focus:outline-none focus:border-cyan-500/50"
              @change="assignAmount = Math.max(1, Math.floor(assignAmount || 1))"
            />
            <button
              type="button"
              aria-label="More miners"
              class="w-8 h-8 flex items-center justify-center rounded border border-white/10 text-white/60 hover:bg-white/8 hover:text-white/90 transition text-[14px]"
              @click="assignAmount = assignAmount + 1"
            >
              +
            </button>
            <button
              type="button"
              class="px-3 h-8 flex items-center justify-center rounded border border-white/10 text-white/50 hover:bg-white/8 hover:text-white/80 transition text-[10px] uppercase tracking-wider"
              @click="assignAmount = Math.max(1, availableAmount)"
            >
              Max
            </button>
          </div>
        </div>
      </div>

      <span v-if="assignAmount > availableAmount" class="text-[10px] text-red-400/85">
        Max available: {{ availableAmount }}
      </span>

      <div class="rounded border border-white/8 bg-white/2.5 px-3 py-2 min-h-[52px]">
        <span v-if="previewLoading" class="text-[11px] text-white/45 animate-pulse">
          Calculating…
        </span>
        <span v-else-if="previewError" class="text-[11px] text-red-400/80">{{ previewError }}</span>
        <div v-else-if="preview" class="grid grid-cols-5 gap-3 text-[10px] tabular-nums">
          <div class="flex flex-col gap-0.5">
            <span class="text-white/35">Flight</span>
            <span class="text-white/75">{{ formatDuration(preview.oneWayTravelHours) }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-white/35">Mining</span>
            <span class="text-white/75">{{ formatDuration(preview.miningHours) }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-white/35">Round trip</span>
            <span class="text-white/75">{{ formatDuration(preview.roundTripHours) }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-white/35">Delivery</span>
            <span class="text-cyan-300/90 font-semibold"
              >{{ formatNumber(preview.totalDeliveryPerHour) }}/h</span
            >
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-white/35">Depletion</span>
            <span class="text-amber-300/85">{{
              preview.estimatedDepletionHours === null
                ? 'Unknown'
                : formatDuration(preview.estimatedDepletionHours)
            }}</span>
          </div>
        </div>
      </div>

      <div v-if="assignError" class="text-[11px] text-red-400/85">{{ assignError }}</div>

      <button
        type="button"
        :disabled="assigning || !selectedSpacecraftKey || assignAmount > availableAmount"
        class="h-8 rounded text-[11px] uppercase tracking-wider bg-cyan-400/10 text-cyan-300/90 border border-cyan-400/30 hover:bg-cyan-400/15 hover:text-cyan-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
        @click="submit"
      >
        {{ submitLabel }}
      </button>
    </template>
  </div>
</template>
