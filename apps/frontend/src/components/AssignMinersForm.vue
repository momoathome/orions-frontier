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

// Never go past the idle count: no warning line, no failing preview, so the modal keeps its size.
watch([assignAmount, availableAmount], ([amount, available]) => {
  if (available > 0 && amount > available) assignAmount.value = available;
});

let previewRequest = 0;
watch(
  [selectedSpacecraftKey, assignAmount],
  async ([spacecraftKey, minerCount]) => {
    const requestId = ++previewRequest;
    previewError.value = null;
    // Keep the last forecast on screen while the next one loads, so the modal keeps its size.
    if (!spacecraftKey || minerCount < 1) {
      preview.value = null;
      previewLoading.value = false;
      return;
    }

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
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
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
  <div class="flex flex-col gap-4">
    <span v-if="miners === null" class="animate-pulse text-ui-muted">Loading hangar…</span>
    <div v-else-if="miners.length === 0" class="flex flex-col gap-1">
      <span class="font-semibold text-ui-bright">No idle miners at this station</span>
      <span class="text-ui-soft">
        Build miners in the Shipyard (Fleet) or recall some from another asteroid.
      </span>
    </div>

    <template v-else>
      <label class="flex flex-col gap-1.5">
        <span class="text-xs text-ui-muted">Spacecraft</span>
        <select v-model="selectedSpacecraftKey" class="ui-input">
          <option v-for="m in miners" :key="m.definition.key" :value="m.definition.key">
            {{ m.definition.name }} · {{ m.amount - m.lockedAmount }} idle
          </option>
        </select>
      </label>

      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-ui-muted">Amount · {{ availableAmount }} available</span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            aria-label="Fewer miners"
            class="ui-btn ui-btn-icon h-10 w-10 text-base"
            :disabled="assignAmount <= 1"
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
            class="ui-input ui-num w-20 text-center"
            @change="assignAmount = Math.max(1, Math.floor(assignAmount || 1))"
          />
          <button
            type="button"
            aria-label="More miners"
            class="ui-btn ui-btn-icon h-10 w-10 text-base"
            :disabled="assignAmount >= availableAmount"
            @click="assignAmount = assignAmount + 1"
          >
            +
          </button>
          <button
            type="button"
            class="ui-btn"
            :disabled="assignAmount >= availableAmount"
            @click="assignAmount = Math.max(1, availableAmount)"
          >
            Max
          </button>
        </div>
      </div>

      <section class="flex flex-col gap-2">
        <h3 class="ui-label">Forecast</h3>
        <span v-if="previewError" class="text-ui-red">{{ previewError }}</span>
        <dl
          v-else-if="preview"
          class="grid grid-cols-3 gap-2.5 transition-opacity"
          :class="{ 'opacity-60': previewLoading }"
          :aria-busy="previewLoading"
        >
          <div class="ui-card gap-0.5 p-3">
            <dt class="text-xs text-ui-muted">Flight</dt>
            <dd class="ui-num text-base text-ui-bright">
              {{ formatDuration(preview.oneWayTravelHours) }}
            </dd>
          </div>
          <div class="ui-card gap-0.5 p-3">
            <dt class="text-xs text-ui-muted">Mining</dt>
            <dd class="ui-num text-base text-ui-bright">
              {{ formatDuration(preview.miningHours) }}
            </dd>
          </div>
          <div class="ui-card gap-0.5 p-3">
            <dt class="text-xs text-ui-muted">Round trip</dt>
            <dd class="ui-num text-base text-ui-bright">
              {{ formatDuration(preview.roundTripHours) }}
            </dd>
          </div>
          <div class="ui-card col-span-2 gap-0.5 p-3">
            <dt class="text-xs text-ui-muted">Delivery</dt>
            <dd class="ui-num text-base font-semibold text-ui-cyan">
              {{ formatNumber(preview.totalDeliveryPerHour) }}/h
            </dd>
          </div>
          <div class="ui-card gap-0.5 p-3">
            <dt class="text-xs text-ui-muted">Depletion</dt>
            <dd class="ui-num text-base text-ui-amber">
              {{
                preview.estimatedDepletionHours === null
                  ? 'Unknown'
                  : formatDuration(preview.estimatedDepletionHours)
              }}
            </dd>
          </div>
        </dl>
        <span v-else-if="previewLoading" class="animate-pulse text-ui-muted">Calculating…</span>
      </section>

      <p v-if="assignError" class="text-ui-red">{{ assignError }}</p>
    </template>

    <div class="flex justify-end gap-2 border-t border-ui-line pt-4">
      <button type="button" class="ui-btn" @click="emit('cancel')">Cancel</button>
      <button
        v-if="miners && miners.length > 0"
        type="button"
        :disabled="assigning || !selectedSpacecraftKey || assignAmount > availableAmount"
        class="ui-btn ui-btn-primary"
        @click="submit"
      >
        {{ submitLabel }}
      </button>
    </div>
  </div>
</template>
