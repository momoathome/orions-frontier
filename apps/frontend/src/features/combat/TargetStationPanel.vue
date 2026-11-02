<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AttackForecast, VisibleStation } from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../../shared/api/api-client';
import { resourceName } from '../../shared/lib/resources';
import { useStationStore } from '../station/index.js';
import { scoutingSummary } from './scouting.js';
import { useCombatStore } from './store.js';
import PanelShell from '../../shared/ui/PanelShell.vue';

const { origin, station } = defineProps<{
  station: VisibleStation;
  origin: { id: string; x: number; y: number } | null;
}>();

const emit = defineEmits<{ close: []; launched: [] }>();
const stationStore = useStationStore();
const combat = useCombatStore();

// Reports come newest first: the latest wave that brought something back from this target.
const lastScouting = computed(
  () =>
    combat.state.combats.find(
      (report) => report.defenderStationId === station.id && report.scouting !== null
    )?.scouting ?? null
);

const distance = computed(() =>
  origin ? Math.hypot(station.x - origin.x, station.y - origin.y) : null
);

const fighters = computed(() =>
  (origin ? (stationStore.state.details[origin.id]?.fleet?.spacecrafts ?? []) : []).filter(
    (entry) =>
      (entry.definition.role === 'fighter' || entry.definition.role === 'bomber') &&
      entry.amount > entry.lockedAmount
  )
);
const amounts = ref<Record<string, number>>({});
const fleet = computed(() =>
  Object.fromEntries(Object.entries(amounts.value).filter(([, amount]) => amount > 0))
);
const hasShips = computed(() => Object.keys(fleet.value).length > 0);
const feedback = ref<string | null>(null);
const sending = ref(false);

watch(
  () => [origin?.id, station.id] as const,
  () => {
    amounts.value = {};
    feedback.value = null;
  }
);

const forecast = ref<AttackForecast | null>(null);
const chanceLabel = { high: 'High', medium: 'Medium', low: 'Low' } as const;
const chanceClass = { high: 'text-ui-green', medium: 'text-ui-amber', low: 'text-ui-red' } as const;
let forecastTimer: ReturnType<typeof setTimeout> | undefined;
let forecastRequest = 0;
// The server predicts from what the scanner sees; typing in the amounts waits for a short pause.
watch(
  () => [origin?.id, station.id, fleet.value] as const,
  ([originId, targetId, selected]) => {
    clearTimeout(forecastTimer);
    const request = ++forecastRequest;
    forecast.value = null;
    if (!originId || !station.scanned || Object.keys(selected).length === 0) return;
    forecastTimer = setTimeout(async () => {
      try {
        const result = await apiClient.post<AttackForecast>(
          `/stations/${originId}/attacks/forecast`,
          { targetStationId: targetId, fleet: selected }
        );
        if (request === forecastRequest) forecast.value = result;
      } catch {
        // No forecast is shown; launching the attack reports the actual problem.
      }
    }, 300);
  }
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
    amounts.value = {};
    emit('launched');
  } catch (error) {
    feedback.value = apiErrorMessage(error, 'Attack could not be launched');
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <PanelShell
    label="Target station"
    :eyebrow="`Target station (${station.ownerType})`"
    :title="station.name"
    @close="emit('close')"
  >
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
        <p v-if="lastScouting" class="text-xs text-ui-muted">
          Last report: {{ scoutingSummary(lastScouting) }}
        </p>
        <template v-if="fighters.length > 0">
          <label
            v-for="fighter in fighters"
            :key="fighter.definition.key"
            class="flex items-center justify-between gap-3"
          >
            <span class="flex flex-col">
              <span class="text-ui-bright">{{ fighter.definition.name }}</span>
              <span class="text-xs text-ui-muted">
                {{ fighter.definition.role }} ({{ fighter.amount - fighter.lockedAmount }} ready)
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
        <p v-if="!station.scanned && hasShips" class="text-sm text-ui-soft">
          Win chance unknown: the station is outside your scanner, so the fleet flies blind.
          Survivors report what they saw.
        </p>
        <dl v-if="forecast" class="flex flex-col gap-1 text-sm" aria-live="polite">
          <div class="flex justify-between">
            <dt class="text-ui-soft">Win chance</dt>
            <dd :class="chanceClass[forecast.winChance]">{{ chanceLabel[forecast.winChance] }}</dd>
          </div>
          <div v-for="(range, key) in forecast.loot" :key="key" class="flex justify-between">
            <dt class="text-ui-soft">Expected {{ resourceName(key) }}</dt>
            <dd class="ui-num text-ui-bright">
              {{ range.min.toLocaleString('en-US') }}–{{ range.max.toLocaleString('en-US') }}
            </dd>
          </div>
          <p class="text-xs text-ui-muted">
            Estimated from the scanned station defense; docked ships and research stay unseen.
          </p>
        </dl>
        <p v-if="feedback" class="text-ui-soft">{{ feedback }}</p>
      </section>
    </div>

    <div v-if="fighters.length > 0" class="border-t border-ui-line px-[18px] py-4">
      <button
        type="button"
        :disabled="sending || !hasShips"
        class="ui-btn ui-btn-danger w-full"
        @click="attack"
      >
        {{ sending ? 'Launching…' : 'Launch attack' }}
      </button>
    </div>
  </PanelShell>
</template>
