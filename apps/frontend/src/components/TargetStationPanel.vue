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
  <aside
    class="flex h-full w-[400px] shrink-0 flex-col border-l border-ui-line bg-ui-panel text-left text-sm text-ui-text"
    aria-label="Target station"
  >
    <div class="flex items-start justify-between gap-3 border-b border-ui-line px-[18px] py-4">
      <div class="flex min-w-0 flex-col gap-1">
        <span class="ui-label">Target station · {{ station.ownerType }}</span>
        <h2 class="truncate text-xl font-semibold text-ui-bright">{{ station.name }}</h2>
      </div>
      <button
        type="button"
        class="ui-btn ui-btn-icon"
        aria-label="Close panel"
        @click="$emit('close')"
      >
        ✕
      </button>
    </div>

    <div class="flex flex-1 flex-col gap-5 overflow-y-auto px-[18px] py-4">
      <dl class="grid grid-cols-3 gap-2 text-xs text-ui-muted">
        <div class="flex flex-col gap-0.5">
          <dt>Coordinates</dt>
          <dd class="ui-num text-sm text-ui-text">{{ station.x }} / {{ station.y }}</dd>
        </div>
        <div v-if="distance !== null" class="flex flex-col gap-0.5">
          <dt>Distance</dt>
          <dd class="ui-num text-sm text-ui-text">{{ distance.toFixed(0) }} u</dd>
        </div>
        <div v-if="station.integrity !== null" class="flex flex-col gap-0.5">
          <dt>Integrity</dt>
          <dd class="ui-num text-sm text-ui-text">
            {{ station.isOwn ? station.integrity : `≤ ${station.integrity}` }}%
          </dd>
        </div>
      </dl>

      <section class="flex flex-col gap-3">
        <h3 class="ui-label">Attack</h3>
        <p v-if="!station.scanned" class="text-ui-soft">
          Outside scanner range. Upgrade a scanner or found a station nearby to target it.
        </p>
        <template v-else-if="fighters.length > 0">
          <label
            v-for="fighter in fighters"
            :key="fighter.definition.key"
            class="flex items-center justify-between gap-3"
          >
            <span class="flex flex-col">
              <span class="text-ui-bright">{{ fighter.definition.name }}</span>
              <span class="text-xs text-ui-muted">
                {{ fighter.definition.role }} · {{ fighter.amount - fighter.lockedAmount }} ready
              </span>
            </span>
            <input
              v-model.number="amounts[fighter.definition.key]"
              type="number"
              min="0"
              :max="fighter.amount - fighter.lockedAmount"
              :aria-label="`${fighter.definition.name} to send`"
              class="ui-input ui-num w-24"
            />
          </label>
        </template>
        <p v-else class="text-ui-soft">
          No fighter or bomber is ready. Build them in the Shipyard (Fleet).
        </p>
        <p v-if="feedback" class="text-ui-soft">{{ feedback }}</p>
      </section>
    </div>

    <div
      v-if="station.scanned && fighters.length > 0"
      class="border-t border-ui-line px-[18px] py-4"
    >
      <button
        type="button"
        :disabled="sending || !hasShips"
        class="ui-btn ui-btn-danger w-full"
        @click="attack"
      >
        {{ sending ? 'Launching…' : 'Launch attack' }}
      </button>
    </div>
  </aside>
</template>
