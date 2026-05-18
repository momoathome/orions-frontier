<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { apiClient } from '../lib/api-client';
import type { AsteroidDetail, AsteroidVein } from '@orions-frontier/shared';
import type { StationSpacecraftWithDefinition } from '@orions-frontier/shared';

const props = defineProps<{
  show: boolean;
  miners: StationSpacecraftWithDefinition[];
  asteroid: AsteroidDetail;
  asteroidId: string;
  stationId: string;
  effectiveRateByResource: Record<string, number>;
  totalMiningPowerRaw: number;
  stabilityChangePerHour: number | null;
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

watch(
  () => props.show,
  (val) => {
    if (val) {
      selectedDefId.value = props.miners[0]?.definition.id ?? '';
      assignAmount.value = 1;
      assignError.value = null;
      assigning.value = false;
    }
  },
);

// ── Derived ───────────────────────────────────────────────────────────────────

const selectedMiner = computed(() =>
  props.miners.find((m) => m.definition.id === selectedDefId.value) ?? null,
);

const assignTotalPower = computed(() =>
  (assignAmount.value ?? 0) * (selectedMiner.value?.definition.miningRate ?? 0),
);

const VEIN_ALLOCATION: Record<string, number> = { primary: 0.70, secondary: 0.25, trace: 0.05 };
const STABILITY_DEGRADATION_PER_HOUR = 0.05;
const STABILITY_REGEN_PER_HOUR = 0.01;

const RESOURCE_NAMES: Record<string, string> = {
  carbon: 'Carbon', titanium: 'Titanium', hydrogenium: 'Hydrogenium',
  kyber_crystal: 'Kyber Crystal', astatine: 'Astatine',
};
const RESOURCE_COLORS: Record<string, string> = {
  carbon: '#778899', titanium: '#6699bb', hydrogenium: '#22ccee',
  kyber_crystal: '#aa33ff', astatine: '#ff5533',
};
function resourceName(key: string) { return RESOURCE_NAMES[key] ?? key.toUpperCase(); }
function resourceColor(key: string) { return RESOURCE_COLORS[key] ?? '#888888'; }

const assignPreviewRates = computed<Record<string, number>>(() => {
  if (!selectedMiner.value || assignAmount.value < 1) return {};
  const newTotalRate = props.totalMiningPowerRaw + assignTotalPower.value;
  const result: Record<string, number> = {};
  for (const vein of props.asteroid.veins) {
    const allocation = VEIN_ALLOCATION[vein.veinType] ?? 0.70;
    const cappedRate = Math.min(newTotalRate * allocation * vein.purity, vein.yieldPerHour);
    result[vein.resourceKey] = (result[vein.resourceKey] ?? 0) + cappedRate * props.asteroid.stability;
  }
  return result;
});

const assignPreviewStabilityChange = computed<number | null>(() => {
  if (!selectedMiner.value || assignAmount.value < 1) return null;
  const newTotalRate = props.totalMiningPowerRaw + assignTotalPower.value;
  let totalMiningLoad = 0;
  let totalYieldCap = 0;
  for (const vein of props.asteroid.veins) {
    totalMiningLoad += newTotalRate * (VEIN_ALLOCATION[vein.veinType] ?? 0.70);
    totalYieldCap += vein.yieldPerHour;
  }
  if (totalYieldCap === 0) return null;
  return totalMiningLoad > totalYieldCap
    ? -STABILITY_DEGRADATION_PER_HOUR * (totalMiningLoad / totalYieldCap)
    : STABILITY_REGEN_PER_HOUR;
});

// ── Actions ───────────────────────────────────────────────────────────────────

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
  } catch (err: any) {
    assignError.value = err?.response?.data?.message ?? 'Assignment failed';
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
      <div class="bg-[#060c1b] border border-cyan-400/20 rounded p-5 w-80 flex flex-col gap-4 font-mono">
        <!-- Header -->
        <div class="flex items-center justify-between">
          <span class="text-[10px] text-white/50 uppercase tracking-widest">Assign Miner</span>
          <button @click="emit('close')" class="text-white/30 hover:text-white/60 text-[11px]">✕</button>
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
                {{ m.definition.name }} ({{ m.definition.miningRate }}/h per ship · ×{{ m.amount - m.lockedAmount }} avail.)
              </option>
            </select>
          </div>

          <!-- Amount -->
          <div class="flex flex-col gap-1.5">
            <label class="text-[9px] text-white/25 uppercase tracking-wider">Amount</label>
            <input
              v-model.number="assignAmount"
              type="number"
              min="1"
              :max="selectedMiner ? selectedMiner.amount - selectedMiner.lockedAmount : 1"
              class="bg-white/5 border border-white/10 rounded px-2 h-7 text-[11px] text-white/80 focus:outline-none focus:border-cyan-400/40 tabular-nums"
            />
            <span
              v-if="selectedMiner && assignAmount > selectedMiner.amount - selectedMiner.lockedAmount"
              class="text-[9px] text-red-400/80"
            >Max available: {{ selectedMiner.amount - selectedMiner.lockedAmount }}</span>
            <span v-else-if="assignTotalPower > 0" class="text-[9px] text-white/25">
              Total mining power: {{ assignTotalPower }}/h
            </span>
          </div>

          <!-- Impact Preview -->
          <div
            v-if="assignAmount >= 1 && selectedMiner"
            class="flex flex-col gap-1.5 pt-2 border-t border-white/8"
          >
            <span class="text-[9px] text-white/20 uppercase tracking-wider">Impact Preview</span>
            <div
              v-for="vein in asteroid.veins"
              :key="vein.id"
              class="flex items-center justify-between text-[9px]"
            >
              <span :style="`color:${resourceColor(vein.resourceKey)}`">{{ resourceName(vein.resourceKey) }}</span>
              <div class="flex items-center gap-1 tabular-nums">
                <span class="text-white/25">{{ (effectiveRateByResource[vein.resourceKey] ?? 0).toFixed(1) }}/h</span>
                <span class="text-white/15">→</span>
                <span
                  :class="(assignPreviewRates[vein.resourceKey] ?? 0) > (effectiveRateByResource[vein.resourceKey] ?? 0)
                    ? 'text-emerald-400/80' : 'text-white/40'"
                >{{ (assignPreviewRates[vein.resourceKey] ?? 0).toFixed(1) }}/h</span>
              </div>
            </div>
            <div class="flex items-center justify-between text-[9px] mt-0.5 pt-1.5 border-t border-white/5">
              <span class="text-white/25">Stability/h</span>
              <div class="flex items-center gap-1 tabular-nums">
                <span :class="(stabilityChangePerHour ?? 0) < 0 ? 'text-red-400/50' : 'text-white/25'">
                  {{ stabilityChangePerHour !== null
                    ? ((stabilityChangePerHour > 0 ? '+' : '') + (stabilityChangePerHour * 100).toFixed(2) + '%')
                    : '—' }}
                </span>
                <span class="text-white/15">→</span>
                <span :class="(assignPreviewStabilityChange ?? 0) < 0 ? 'text-red-400/80 font-semibold' : 'text-emerald-400/70'">
                  {{ assignPreviewStabilityChange !== null
                    ? ((assignPreviewStabilityChange > 0 ? '+' : '') + (assignPreviewStabilityChange * 100).toFixed(2) + '%')
                    : '—' }}
                </span>
              </div>
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
