<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { StationSpacecraftWithDefinition, VisibleStation } from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../lib/api-client';

const props = defineProps<{
  station: VisibleStation;
  origin: { id: string; x: number; y: number } | null;
}>();

defineEmits<{ close: [] }>();

const distance = computed(() =>
  props.origin
    ? Math.hypot(props.station.x - props.origin.x, props.station.y - props.origin.y)
    : null
);

const fighters = ref<StationSpacecraftWithDefinition[]>([]);
const selectedSpacecraftKey = ref('');
const amount = ref(1);
const feedback = ref<string | null>(null);
const sending = ref(false);

watch(
  () => [props.origin?.id, props.station.id] as const,
  async ([stationId]) => {
    fighters.value = [];
    if (!stationId) return;
    try {
      const fleetResponse = await apiClient.get(`/stations/${stationId}/spacecrafts`);
      fighters.value = fleetResponse.spacecrafts.filter(
        (entry: StationSpacecraftWithDefinition) =>
          entry.definition.role === 'fighter' && entry.amount > entry.lockedAmount
      );
      selectedSpacecraftKey.value = fighters.value[0]?.definition.key ?? '';
    } catch (error) {
      feedback.value = apiErrorMessage(error, 'Target data could not be loaded');
    }
  },
  { immediate: true }
);

async function attack() {
  if (!props.origin || !selectedSpacecraftKey.value) return;
  sending.value = true;
  feedback.value = null;
  try {
    await apiClient.post(`/stations/${props.origin.id}/attacks`, {
      targetStationId: props.station.id,
      spacecraftKey: selectedSpacecraftKey.value,
      amount: amount.value,
    });
    feedback.value = 'Attack launched.';
  } catch (error) {
    feedback.value = apiErrorMessage(error, 'Attack could not be launched');
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div
    class="absolute bottom-0 left-0 z-20 flex min-h-48 w-full cursor-default flex-col border-t-2 border-amber-400/35 bg-[#060c1b]/97 font-mono backdrop-blur-xl"
  >
    <div class="flex h-11 shrink-0 items-center justify-between border-b border-white/7 px-5">
      <div class="flex items-center gap-3">
        <span class="text-[9px] uppercase tracking-[0.35em] text-amber-300/45">Target station</span>
        <span class="text-sm font-semibold tracking-widest text-white/90">{{ station.name }}</span>
        <span class="text-[9px] uppercase tracking-widest text-white/25">
          {{ station.ownerType }}
        </span>
      </div>
      <button
        class="flex h-7 w-7 items-center justify-center rounded text-[11px] text-white/50 transition hover:bg-white/5 hover:text-white/80"
        @click="$emit('close')"
      >
        ✕
      </button>
    </div>

    <div class="grid flex-1 grid-cols-2 gap-8 px-5 py-4">
      <div class="flex flex-col gap-2 text-[10px]">
        <span class="text-[9px] uppercase tracking-[0.3em] text-white/20">Public data</span>
        <div class="flex justify-between border-b border-white/5 pb-1">
          <span class="text-white/30">Coordinates</span>
          <span class="tabular-nums text-white/65">{{ station.x }} / {{ station.y }}</span>
        </div>
        <div v-if="distance !== null" class="flex justify-between border-b border-white/5 pb-1">
          <span class="text-white/30">Distance</span>
          <span class="tabular-nums text-white/65">{{ distance.toFixed(0) }}</span>
        </div>
      </div>

      <div class="flex flex-col gap-2 border-l border-white/5 pl-5">
        <span class="text-[9px] uppercase tracking-[0.3em] text-white/20">Actions</span>
        <template v-if="fighters.length > 0">
          <select
            v-model="selectedSpacecraftKey"
            class="h-7 rounded border border-white/10 bg-[#080d18] px-2 text-[10px] text-white/70"
          >
            <option
              v-for="fighter in fighters"
              :key="fighter.definition.key"
              :value="fighter.definition.key"
            >
              {{ fighter.definition.name }} ({{ fighter.amount - fighter.lockedAmount }} ready)
            </option>
          </select>
          <input
            v-model.number="amount"
            type="number"
            min="1"
            class="h-7 rounded border border-white/10 bg-white/5 px-2 text-[10px]"
          />
          <button
            :disabled="sending || amount < 1"
            class="h-7 rounded border border-red-400/30 text-[9px] uppercase tracking-widest text-red-300 disabled:opacity-30"
            @click="attack"
          >
            {{ sending ? 'Launching…' : 'Attack' }}
          </button>
        </template>
        <p v-else class="text-[9px] text-white/25">No fighter is available.</p>
        <p v-if="feedback" class="text-[9px] text-white/50">{{ feedback }}</p>
      </div>
    </div>
  </div>
</template>
