<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { apiClient } from '../lib/api-client';
import type { AsteroidDetail } from '@orions-frontier/shared';
import {
  resourceColor,
  resourceName,
  calcEffectiveRateByResource,
  calcStabilityChangePerHour,
} from '../lib/mining-utils';

export interface AssignmentGroup {
  stationId: string;
  spacecraftDefinitionId: string;
  spacecraftName: string;
  spacecraftMiningRate: number;
  ids: string[];
  totalAmount: number;
  isOwn: boolean;
}

const props = defineProps<{
  show: boolean;
  ownGroups: AssignmentGroup[];
  asteroid: AsteroidDetail;
  asteroidId: string;
  stationId: string;
  totalMiningPowerRaw: number;
  effectiveRateByResource: Record<string, number>;
  stabilityChangePerHour: number | null;
}>();

const emit = defineEmits<{
  close: [];
  done: [];
}>();

// ── Internal state ────────────────────────────────────────────────────────────

const selectedDefId = ref('');
const recallAmount = ref(1);
const recallError = ref<string | null>(null);
const recalling = ref(false);

watch(
  () => props.show,
  (val) => {
    if (val) {
      selectedDefId.value = props.ownGroups[0]?.spacecraftDefinitionId ?? '';
      recallAmount.value = props.ownGroups[0]?.totalAmount ?? 1;
      recallError.value = null;
      recalling.value = false;
    }
  },
);

watch(selectedDefId, (id) => {
  const g = props.ownGroups.find((g) => g.spacecraftDefinitionId === id);
  if (g) recallAmount.value = g.totalAmount;
});

// ── Derived ───────────────────────────────────────────────────────────────────

const selectedGroup = computed(() =>
  props.ownGroups.find((g) => g.spacecraftDefinitionId === selectedDefId.value) ?? null,
);

const recallPower = computed(() =>
  (recallAmount.value ?? 0) * (selectedGroup.value?.spacecraftMiningRate ?? 0),
);

const previewRates = computed<Record<string, number>>(() => {
  if (!selectedGroup.value || recallAmount.value < 1) return props.effectiveRateByResource;
  return calcEffectiveRateByResource(
    Math.max(0, props.totalMiningPowerRaw - recallPower.value),
    props.asteroid.veins,
  );
});

const previewStabilityChange = computed<number | null>(() => {
  if (!selectedGroup.value || recallAmount.value < 1) return props.stabilityChangePerHour;
  const remainingPower = Math.max(0, props.totalMiningPowerRaw - recallPower.value);
  const remainingMiners =
    props.totalMiningPowerRaw > 0
      ? props.asteroid.assignments.length - (recallAmount.value >= (selectedGroup.value?.totalAmount ?? 0) ? 1 : 0)
      : 0;
  return calcStabilityChangePerHour(remainingPower, props.asteroid.veins, remainingMiners > 0);
});

// ── Actions ───────────────────────────────────────────────────────────────────

function setMaxRecall() {
  const max = selectedGroup.value?.totalAmount ?? 1;
  recallAmount.value = Math.max(1, isFinite(max) ? max : 1);
}

async function submit() {
  if (!selectedGroup.value) return;
  const maxAmount = selectedGroup.value.totalAmount;
  if (recallAmount.value < 1 || recallAmount.value > maxAmount) {
    recallError.value = `Only ${maxAmount} ${selectedGroup.value.spacecraftName ?? 'spacecraft'} available.`;
    return;
  }
  const group = selectedGroup.value;
  recalling.value = true;
  recallError.value = null;
  const headers = { 'x-station-id': props.stationId };
  try {
    if (recallAmount.value >= group.totalAmount) {
      for (const id of group.ids) {
        await apiClient.delete(`/asteroids/${props.asteroidId}/assignments/${id}`, { headers });
      }
    } else {
      await apiClient.put(
        `/asteroids/${props.asteroidId}/assignments/${group.ids[0]}`,
        { assignedAmount: group.totalAmount - recallAmount.value },
        { headers },
      );
    }
    emit('done');
  } catch (err: any) {
    recallError.value = err?.response?.data?.message ?? 'Recall failed';
  } finally {
    recalling.value = false;
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
      <div class="bg-[#060c1b] border border-red-400/20 rounded p-5 w-80 flex flex-col gap-4 font-mono">
        <!-- Header -->
        <div class="flex items-center justify-between">
          <span class="text-[10px] text-white/50 uppercase tracking-widest">Recall Miners</span>
          <button @click="emit('close')" class="text-white/30 hover:text-white/60 text-[11px]">✕</button>
        </div>

        <div v-if="ownGroups.length === 0" class="text-[10px] text-white/30 text-center py-3">
          No own miners assigned
        </div>

        <template v-else>
          <!-- Spacecraft select -->
          <div class="flex flex-col gap-1.5">
            <label class="text-[9px] text-white/25 uppercase tracking-wider">Spacecraft</label>
            <select
              v-model="selectedDefId"
              class="bg-white/5 border border-white/10 rounded px-2 h-7 text-[11px] text-white/80 focus:outline-none focus:border-red-400/30"
            >
              <option
                v-for="g in ownGroups"
                :key="g.spacecraftDefinitionId"
                :value="g.spacecraftDefinitionId"
              >
                {{ g.spacecraftName }} (×{{ g.totalAmount }})
              </option>
            </select>
          </div>

          <!-- Amount -->
          <div class="flex flex-col gap-1.5">
            <label class="text-[9px] text-white/25 uppercase tracking-wider">Amount to Recall</label>
            <div class="flex items-center gap-1 w-full">
              <button
                @click="recallAmount = Math.max(1, recallAmount - 1)"
                class="w-7 h-7 flex items-center justify-center rounded border border-white/10 text-white/50 hover:bg-white/8 hover:text-white/80 transition"
              >
                −
              </button>
              <input
                v-model.number="recallAmount"
                type="number"
                min="1"
                step="1"
                :max="selectedGroup?.totalAmount ?? 1"
                @change="recallAmount = Math.max(1, Math.floor(recallAmount || 1))"
                class="flex-1 h-7 text-center text-[12px] text-white/80 bg-white/5 border border-white/12 rounded tabular-nums focus:outline-none focus:border-red-400/30"
              />
              <button
                @click="recallAmount = recallAmount + 1"
                class="w-7 h-7 flex items-center justify-center rounded border border-white/10 text-white/50 hover:bg-white/8 hover:text-white/80 transition"
              >
                +
              </button>
              <button
                @click="setMaxRecall()"
                class="px-2 h-7 flex items-center justify-center rounded border border-white/10 text-white/35 hover:bg-white/8 hover:text-white/70 transition text-[9px] uppercase tracking-widest"
              >
                Max
              </button>
            </div>
            <span v-if="selectedGroup && recallAmount > selectedGroup.totalAmount" class="text-[9px] text-red-400/80">
              Max available: {{ selectedGroup.totalAmount }}
            </span>
            <span v-else-if="recallPower > 0" class="text-[9px] text-white/25">
              Removes {{ recallPower.toFixed(0) }}/h mining power
            </span>
          </div>

          <!-- Impact Preview -->
          <div
            v-if="recallAmount >= 1 && selectedGroup"
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
                  :class="(previewRates[vein.resourceKey] ?? 0) < (effectiveRateByResource[vein.resourceKey] ?? 0)
                    ? 'text-red-400/80 font-semibold' : 'text-white/40'"
                >{{ (previewRates[vein.resourceKey] ?? 0).toFixed(1) }}/h</span>
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
                <span :class="(previewStabilityChange ?? 0) < 0 ? 'text-red-400/80 font-semibold' : 'text-emerald-400/70'">
                  {{ previewStabilityChange !== null
                    ? ((previewStabilityChange > 0 ? '+' : '') + (previewStabilityChange * 100).toFixed(2) + '%')
                    : '—' }}
                </span>
              </div>
            </div>
          </div>

          <div v-if="recallError" class="text-[9px] text-red-400/80">{{ recallError }}</div>

          <button
            @click="submit"
            :disabled="recalling || !selectedGroup || recallAmount < 1"
            class="h-7 rounded text-[9px] uppercase tracking-widest bg-red-400/10 text-red-400/80 border border-red-400/25 hover:bg-red-400/15 hover:text-red-400 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {{ recalling ? 'Recalling…' : `Recall` }}
          </button>
        </template>
      </div>
    </div>
  </transition>
</template>
