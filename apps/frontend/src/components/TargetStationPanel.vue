<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
  StationSpacecraftsResponse,
  StationSpacecraftWithDefinition,
  VisibleStation,
} from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../lib/api-client';

const { origin, station } = defineProps<{
  station: VisibleStation;
  origin: { id: string; x: number; y: number } | null;
}>();

defineEmits<{ close: [] }>();

const distance = computed(() =>
  origin ? Math.hypot(station.x - origin.x, station.y - origin.y) : null
);

const fighters = ref<StationSpacecraftWithDefinition[]>([]);
const amounts = ref<Record<string, number>>({});
const fleet = computed(() =>
  Object.fromEntries(Object.entries(amounts.value).filter(([, amount]) => amount > 0))
);
const hasShips = computed(() => Object.keys(fleet.value).length > 0);
const feedback = ref<string | null>(null);
const sending = ref(false);

watch(
  () => [origin?.id, station.id] as const,
  async ([stationId]) => {
    fighters.value = [];
    if (!stationId) return;
    try {
      const fleetResponse = await apiClient.get<StationSpacecraftsResponse>(
        `/stations/${stationId}/spacecrafts`
      );
      fighters.value = fleetResponse.spacecrafts.filter(
        (entry) =>
          (entry.definition.role === 'fighter' || entry.definition.role === 'bomber') &&
          entry.amount > entry.lockedAmount
      );
      amounts.value = Object.fromEntries(fighters.value.map((entry) => [entry.definition.key, 0]));
    } catch (error) {
      feedback.value = apiErrorMessage(error, 'Target data could not be loaded');
    }
  },
  { immediate: true }
);

async function attack() {
  if (!origin || !hasShips.value) return;
  sending.value = true;
  feedback.value = null;
  try {
    await apiClient.post(`/stations/${origin.id}/attacks`, {
      targetStationId: station.id,
      fleet: fleet.value,
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
        type="button"
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
        <div
          v-if="station.integrity !== null"
          class="flex justify-between border-b border-white/5 pb-1"
        >
          <span class="text-white/30">Integrity</span>
          <span class="tabular-nums text-white/65">
            {{ station.isOwn ? station.integrity : `≤ ${station.integrity}` }}%
          </span>
        </div>
      </div>

      <div class="flex flex-col gap-2 border-l border-white/5 pl-5">
        <span class="text-[9px] uppercase tracking-[0.3em] text-white/20">Actions</span>
        <p v-if="!station.scanned" class="text-[9px] leading-relaxed text-white/35">
          Outside scanner range. Upgrade a scanner or found a station nearby to target it.
        </p>
        <template v-else-if="fighters.length > 0">
          <label
            v-for="fighter in fighters"
            :key="fighter.definition.key"
            class="flex items-center justify-between gap-2 text-[10px] text-white/60"
          >
            <span>
              {{ fighter.definition.name }}
              <span class="text-white/30">
                {{ fighter.definition.role }} · {{ fighter.amount - fighter.lockedAmount }} ready
              </span>
            </span>
            <input
              v-model.number="amounts[fighter.definition.key]"
              type="number"
              min="0"
              :max="fighter.amount - fighter.lockedAmount"
              class="h-7 w-20 rounded border border-white/10 bg-white/5 px-2 text-[10px]"
            />
          </label>
          <button
            type="button"
            :disabled="sending || !hasShips"
            class="h-7 rounded border border-red-400/30 text-[9px] uppercase tracking-widest text-red-300 disabled:opacity-30"
            @click="attack"
          >
            {{ sending ? 'Launching…' : 'Attack' }}
          </button>
        </template>
        <p v-else class="text-[9px] text-white/25">No fighter or bomber is available.</p>
        <p v-if="feedback" class="text-[9px] text-white/50">{{ feedback }}</p>
      </div>
    </div>
  </div>
</template>
