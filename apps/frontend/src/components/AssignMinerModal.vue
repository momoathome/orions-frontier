<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { apiClient, apiErrorMessage } from '../lib/api-client';
import type { AsteroidDetail } from '@orions-frontier/shared';
import type { StationSpacecraftWithDefinition } from '@orions-frontier/shared';
import { resourceColor, resourceName } from '../lib/mining-utils';

const props = defineProps<{
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

// ── Internal state ────────────────────────────────────────────────────────────

const selectedDefId = ref('');
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
  () => props.show,
  (val) => {
    if (val) {
      selectedDefId.value = props.miners[0]?.definition.id ?? '';
      assignAmount.value = 1;
      assignError.value = null;
      assigning.value = false;
      preview.value = null;
      previewError.value = null;
    }
  }
);

// ── Derived ───────────────────────────────────────────────────────────────────

const selectedMiner = computed(
  () => props.miners.find((m) => m.definition.id === selectedDefId.value) ?? null
);

let previewRequest = 0;
watch(
  [() => props.show, selectedDefId, assignAmount],
  async ([show, spacecraftDefinitionId, minerCount]) => {
    const requestId = ++previewRequest;
    preview.value = null;
    previewError.value = null;
    if (!show || !spacecraftDefinitionId || minerCount < 1) return;

    previewLoading.value = true;
    try {
      const response = await apiClient.get(`/asteroids/${props.asteroidId}/mining-preview`, {
        params: {
          stationId: props.stationId,
          spacecraftDefinitionId,
          minerCount,
        },
      });
      if (requestId === previewRequest) preview.value = response.data;
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

// ── Actions ───────────────────────────────────────────────────────────────────

function setMaxAmount() {
  const max = (selectedMiner.value?.amount ?? 0) - (selectedMiner.value?.lockedAmount ?? 0);
  assignAmount.value = Math.max(1, isFinite(max) ? max : 1);
}

async function submit() {
  if (!selectedDefId.value) return;
  const maxAmount = (selectedMiner.value?.amount ?? 0) - (selectedMiner.value?.lockedAmount ?? 0);
  if (assignAmount.value < 1 || assignAmount.value > maxAmount) {
    assignError.value = `Only ${maxAmount} ${selectedMiner.value?.definition.name ?? 'spacecraft'} available.`;
    return;
  }
  assigning.value = true;
  assignError.value = null;
  try {
    await apiClient.post(`/asteroids/${props.asteroidId}/assignments`, {
      stationId: props.stationId,
      spacecraftDefinitionId: selectedDefId.value,
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
        class="bg-[#060c1b] border border-cyan-400/20 rounded p-5 w-80 flex flex-col gap-4 font-mono"
      >
        <!-- Header -->
        <div class="flex items-center justify-between">
          <span class="text-[10px] text-white/50 uppercase tracking-widest">Assign Miner</span>
          <button @click="emit('close')" class="text-white/30 hover:text-white/60 text-[11px]">
            ✕
          </button>
        </div>

        <div v-if="miners.length === 0" class="text-[10px] text-white/30 text-center py-3">
          No mining spacecraft at station
        </div>

        <template v-else>
          <!-- Spacecraft select -->
          <div class="flex flex-col gap-1.5">
            <label class="text-[9px] text-white/25 uppercase tracking-wider">Spacecraft</label>
            <select
              v-model="selectedDefId"
              class="bg-white/5 border border-white/10 rounded px-2 h-7 text-[11px] text-white/80 focus:outline-none focus:border-cyan-400/40"
            >
              <option v-for="m in miners" :key="m.definition.id" :value="m.definition.id">
                {{ m.definition.name }} (×{{ m.amount - m.lockedAmount }})
              </option>
            </select>
          </div>

          <!-- Amount -->
          <div class="flex flex-col gap-1.5">
            <label class="text-[9px] text-white/25 uppercase tracking-wider">Amount</label>
            <div class="flex items-center gap-1 w-full">
              <button
                @click="assignAmount = Math.max(1, assignAmount - 1)"
                class="w-7 h-7 flex items-center justify-center rounded border border-white/10 text-white/50 hover:bg-white/8 hover:text-white/80 transition"
              >
                −
              </button>
              <input
                v-model.number="assignAmount"
                type="number"
                min="1"
                step="1"
                :max="selectedMiner ? selectedMiner.amount - selectedMiner.lockedAmount : 1"
                @change="assignAmount = Math.max(1, Math.floor(assignAmount || 1))"
                class="flex-1 h-7 text-center text-[12px] text-white/80 bg-white/5 border border-white/12 rounded tabular-nums focus:outline-none focus:border-cyan-500/50"
              />
              <button
                @click="assignAmount = assignAmount + 1"
                class="w-7 h-7 flex items-center justify-center rounded border border-white/10 text-white/50 hover:bg-white/8 hover:text-white/80 transition"
              >
                +
              </button>
              <button
                @click="setMaxAmount()"
                class="px-2 h-7 flex items-center justify-center rounded border border-white/10 text-white/35 hover:bg-white/8 hover:text-white/70 transition text-[9px] uppercase tracking-widest"
              >
                Max
              </button>
            </div>
            <span
              v-if="
                selectedMiner && assignAmount > selectedMiner.amount - selectedMiner.lockedAmount
              "
              class="text-[9px] text-red-400/80"
              >Max available: {{ selectedMiner.amount - selectedMiner.lockedAmount }}</span
            >
            <span v-else-if="selectedMiner" class="text-[9px] text-white/25">
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
            <span class="text-[9px] text-white/20 uppercase tracking-wider">Mining Preview</span>
            <span v-if="previewLoading" class="text-[9px] text-white/25 animate-pulse"
              >Calculating…</span
            >
            <span v-else-if="previewError" class="text-[9px] text-red-400/70">{{
              previewError
            }}</span>
            <template v-else-if="preview">
              <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[9px] tabular-nums">
                <span class="text-white/25">Distance</span>
                <span class="text-right text-white/60">{{ formatNumber(preview.distance) }}</span>
                <span class="text-white/25">Flight each way</span>
                <span class="text-right text-white/60">{{
                  formatDuration(preview.oneWayTravelHours)
                }}</span>
                <span class="text-white/25">Mining</span>
                <span class="text-right text-white/60">{{
                  formatDuration(preview.miningHours)
                }}</span>
                <span class="text-white/25">Round trip</span>
                <span class="text-right text-white/60">{{
                  formatDuration(preview.roundTripHours)
                }}</span>
                <span class="text-white/25">Delivery</span>
                <span class="text-right text-cyan-400/80 font-semibold"
                  >{{ formatNumber(preview.totalDeliveryPerHour) }}/h</span
                >
                <span class="text-white/25">Reserve</span>
                <span class="text-right text-white/60">{{
                  formatNumber(preview.remainingAmount)
                }}</span>
                <span class="text-white/25">Estimated depletion</span>
                <span class="text-right text-amber-300/75">{{
                  formatDuration(preview.estimatedDepletionHours)
                }}</span>
              </div>
            </template>
            <div
              v-for="vein in asteroid.veins"
              :key="vein.id"
              class="flex items-center justify-between text-[9px]"
            >
              <span :style="`color:${resourceColor(vein.resourceKey)}`">{{
                resourceName(vein.resourceKey)
              }}</span>
              <span class="text-white/45 tabular-nums">{{
                formatNumber(vein.remainingAmount)
              }}</span>
            </div>
          </div>

          <div v-if="assignError" class="text-[9px] text-red-400/80">{{ assignError }}</div>

          <button
            @click="submit"
            :disabled="assigning || !selectedDefId"
            class="h-7 rounded text-[9px] uppercase tracking-widest bg-cyan-400/10 text-cyan-400/80 border border-cyan-400/25 hover:bg-cyan-400/15 hover:text-cyan-400 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {{ assigning ? 'Assigning…' : 'Assign' }}
          </button>
        </template>
      </div>
    </div>
  </transition>
</template>
