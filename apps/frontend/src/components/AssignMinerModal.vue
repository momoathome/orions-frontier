<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { apiClient, apiErrorMessage } from '../lib/api-client';
import type { AsteroidDetail } from '@orions-frontier/shared';
import type { StationSpacecraftWithDefinition } from '@orions-frontier/shared';
import { resourceColor, resourceName } from '../lib/mining-utils';

const { asteroidId, miners, show, stationId } = defineProps<{
  show: boolean;
  miners: StationSpacecraftWithDefinition[];
  asteroid: AsteroidDetail;
  asteroidId: string;
  stationId: string;
}>();

const emit = defineEmits<{
  close: [];
  done: [];
}>();

const selectedSpacecraftKey = ref('');
const assignAmount = ref(1);
const assignError = ref<string | null>(null);
const assigning = ref(false);
const previewLoading = ref(false);
const previewError = ref<string | null>(null);

interface MiningPreview {
  distance: number;
  speed: number;
  miningRate: number;
  cargoCapacity: number;
  remainingAmount: number;
  oneWayTravelHours: number;
  miningHours: number;
  roundTripHours: number;
  deliveryPerHourPerMiner: number;
  totalDeliveryPerHour: number;
  estimatedDepletionHours: number;
}

const preview = ref<MiningPreview | null>(null);

watch(
  () => show,
  (val) => {
    if (val) {
      selectedSpacecraftKey.value = miners[0]?.definition.key ?? '';
      assignAmount.value = 1;
      assignError.value = null;
      assigning.value = false;
      preview.value = null;
      previewError.value = null;
    }
  }
);

const selectedMiner = computed(
  () => miners.find((m) => m.definition.key === selectedSpacecraftKey.value) ?? null
);

let previewRequest = 0;
watch(
  [() => show, selectedSpacecraftKey, assignAmount],
  async ([show, spacecraftKey, minerCount]) => {
    const requestId = ++previewRequest;
    preview.value = null;
    previewError.value = null;
    if (!show || !spacecraftKey || minerCount < 1) return;

    previewLoading.value = true;
    try {
      const response = await apiClient.get<MiningPreview>(
        `/asteroids/${asteroidId}/mining-preview`,
        {
          params: {
            stationId: stationId,
            spacecraftKey,
            minerCount,
          },
        }
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

function setMaxAmount() {
  const max = (selectedMiner.value?.amount ?? 0) - (selectedMiner.value?.lockedAmount ?? 0);
  assignAmount.value = Math.max(1, isFinite(max) ? max : 1);
}

async function submit() {
  if (!selectedSpacecraftKey.value) return;
  const maxAmount = (selectedMiner.value?.amount ?? 0) - (selectedMiner.value?.lockedAmount ?? 0);
  if (assignAmount.value < 1 || assignAmount.value > maxAmount) {
    assignError.value = `Only ${maxAmount} ${selectedMiner.value?.definition.name ?? 'spacecraft'} available.`;
    return;
  }
  assigning.value = true;
  assignError.value = null;
  try {
    await apiClient.post(`/asteroids/${asteroidId}/assignments`, {
      stationId: stationId,
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
  <transition
    enter-active-class="transition-opacity duration-150"
    enter-from-class="opacity-0"
    leave-active-class="transition-opacity duration-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="show"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="emit('close')"
    >
      <div
        class="bg-[#060c1b] border border-cyan-400/20 rounded p-5 w-96 max-w-[calc(100vw-2rem)] flex flex-col gap-4 font-mono"
      >
        <!-- Header -->
        <div class="flex items-center justify-between">
          <span class="text-[12px] text-white/65 uppercase tracking-wider">Assign Miner</span>
          <button
            type="button"
            class="text-white/45 hover:text-white/80 text-[14px]"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>

        <div v-if="miners.length === 0" class="text-[12px] text-white/45 text-center py-3">
          No mining spacecraft at station
        </div>

        <template v-else>
          <!-- Spacecraft select -->
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] text-white/45 uppercase tracking-wide">Spacecraft</label>
            <select
              v-model="selectedSpacecraftKey"
              class="bg-white/5 border border-white/10 rounded px-2 h-8 text-[12px] text-white/85 focus:outline-none focus:border-cyan-400/40"
            >
              <option v-for="m in miners" :key="m.definition.key" :value="m.definition.key">
                {{ m.definition.name }} (×{{ m.amount - m.lockedAmount }})
              </option>
            </select>
          </div>

          <!-- Amount -->
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] text-white/45 uppercase tracking-wide">Amount</label>
            <div class="flex items-center gap-1 w-full">
              <button
                type="button"
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
                :max="selectedMiner ? selectedMiner.amount - selectedMiner.lockedAmount : 1"
                class="flex-1 h-8 text-center text-[13px] text-white/85 bg-white/5 border border-white/12 rounded tabular-nums focus:outline-none focus:border-cyan-500/50"
                @change="assignAmount = Math.max(1, Math.floor(assignAmount || 1))"
              />
              <button
                type="button"
                class="w-8 h-8 flex items-center justify-center rounded border border-white/10 text-white/60 hover:bg-white/8 hover:text-white/90 transition text-[14px]"
                @click="assignAmount = assignAmount + 1"
              >
                +
              </button>
              <button
                type="button"
                class="px-3 h-8 flex items-center justify-center rounded border border-white/10 text-white/50 hover:bg-white/8 hover:text-white/80 transition text-[10px] uppercase tracking-wider"
                @click="setMaxAmount()"
              >
                Max
              </button>
            </div>
            <span
              v-if="
                selectedMiner && assignAmount > selectedMiner.amount - selectedMiner.lockedAmount
              "
              class="text-[10px] text-red-400/85"
              >Max available: {{ selectedMiner.amount - selectedMiner.lockedAmount }}</span
            >
            <span v-else-if="selectedMiner" class="text-[10px] text-white/45">
              {{ selectedMiner.definition.miningRate }}/h ·
              {{ selectedMiner.definition.cargo }} cargo · speed
              {{ selectedMiner.definition.speed }}
            </span>
          </div>

          <!-- Round-trip Preview -->
          <div
            v-if="assignAmount >= 1 && selectedMiner"
            class="flex flex-col gap-1.5 pt-2 border-t border-white/8"
          >
            <span class="text-[10px] text-white/45 uppercase tracking-wide">Mining Preview</span>
            <span v-if="previewLoading" class="text-[11px] text-white/45 animate-pulse"
              >Calculating…</span
            >
            <span v-else-if="previewError" class="text-[11px] text-red-400/80">{{
              previewError
            }}</span>
            <template v-else-if="preview">
              <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] tabular-nums">
                <span class="text-white/45">Distance</span>
                <span class="text-right text-white/75">{{ formatNumber(preview.distance) }}</span>
                <span class="text-white/45">Flight each way</span>
                <span class="text-right text-white/75">{{
                  formatDuration(preview.oneWayTravelHours)
                }}</span>
                <span class="text-white/45">Mining</span>
                <span class="text-right text-white/75">{{
                  formatDuration(preview.miningHours)
                }}</span>
                <span class="text-white/45">Round trip</span>
                <span class="text-right text-white/75">{{
                  formatDuration(preview.roundTripHours)
                }}</span>
                <span class="text-white/45">Delivery</span>
                <span class="text-right text-cyan-300/90 font-semibold"
                  >{{ formatNumber(preview.totalDeliveryPerHour) }}/h</span
                >
                <span class="text-white/45">Reserve</span>
                <span class="text-right text-white/75">{{
                  formatNumber(preview.remainingAmount)
                }}</span>
                <span class="text-white/45">Estimated depletion</span>
                <span class="text-right text-amber-300/85">{{
                  formatDuration(preview.estimatedDepletionHours)
                }}</span>
              </div>
            </template>
            <div
              v-for="vein in asteroid.veins"
              :key="vein.id"
              class="flex items-center justify-between text-[11px]"
            >
              <span :style="`color:${resourceColor(vein.resourceKey)}`">{{
                resourceName(vein.resourceKey)
              }}</span>
              <span class="text-white/65 tabular-nums">{{
                formatNumber(vein.remainingAmount)
              }}</span>
            </div>
          </div>

          <div v-if="assignError" class="text-[11px] text-red-400/85">{{ assignError }}</div>

          <button
            type="button"
            :disabled="assigning || !selectedSpacecraftKey"
            class="h-8 rounded text-[11px] uppercase tracking-wider bg-cyan-400/10 text-cyan-300/90 border border-cyan-400/30 hover:bg-cyan-400/15 hover:text-cyan-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
            @click="submit"
          >
            {{ assigning ? 'Assigning…' : 'Assign' }}
          </button>
        </template>
      </div>
    </div>
  </transition>
</template>
