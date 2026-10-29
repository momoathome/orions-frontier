<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { StationSpacecraftWithDefinition } from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../lib/api-client';
import { formatBuildTime } from '../lib/spacecraft-utils';
import { useOverviewStore } from '../stores/overview.js';
import CostList from './CostList.vue';

const { hangar, ship, stationId } = defineProps<{
  stationId: string;
  ship: StationSpacecraftWithDefinition;
  hangar: { used: number; capacity: number };
}>();

const emit = defineEmits<{ built: [] }>();
const overview = useOverviewStore();

const buildAmount = ref(1);
const buildSubmitting = ref(false);
const buildError = ref<string | null>(null);
const buildSuccess = ref(false);
const playerResources = computed(
  () => overview.state.details[stationId]?.resources?.resources ?? null
);

// Reset state when selected ship changes
watch(
  () => ship,
  () => {
    buildError.value = null;
    buildSuccess.value = false;
  }
);

const maxBuildable = computed(() => {
  const resourceMaximum = Math.min(
    ...ship.definition.costs.map((cost) =>
      cost.amount > 0
        ? Math.floor((playerResources.value?.[cost.resourceKey] ?? 0) / cost.amount)
        : Infinity
    )
  );
  const crewMaximum = Math.floor(Math.max(0, hangar.capacity - hangar.used) / ship.definition.crew);
  return Math.max(0, Math.min(resourceMaximum, crewMaximum));
});

const hasValidAmount = computed(
  () => Number.isInteger(buildAmount.value) && buildAmount.value >= 1
);
const amount = computed(() => (hasValidAmount.value ? buildAmount.value : 1));
const crewNeeded = computed(() => ship.definition.crew * amount.value);
const exceedsCapacity = computed(
  () => hasValidAmount.value && hangar.used + crewNeeded.value > hangar.capacity
);
const totalCosts = computed(() =>
  ship.definition.costs
    .filter((cost) => cost.amount > 0)
    .map((cost) => ({ resourceKey: cost.resourceKey, amount: cost.amount * amount.value }))
);
const lacksResources = computed(
  () =>
    playerResources.value !== null &&
    totalCosts.value.some((cost) => (playerResources.value?.[cost.resourceKey] ?? 0) < cost.amount)
);
const canSubmit = computed(
  () =>
    !buildSubmitting.value &&
    playerResources.value !== null &&
    hasValidAmount.value &&
    !exceedsCapacity.value &&
    !lacksResources.value
);
const blocker = computed(() => {
  if (exceedsCapacity.value)
    return `Not enough hangar space: needs ${crewNeeded.value} crew, ${Math.max(0, hangar.capacity - hangar.used)} free`;
  if (lacksResources.value) return 'Not enough resources for this amount';
  return null;
});
const hangarPercent = (value: number) =>
  hangar.capacity > 0 ? Math.min(100, (value / hangar.capacity) * 100) : 0;

function setMaxAmount() {
  buildAmount.value = Math.max(1, maxBuildable.value);
}

async function submitBuild() {
  if (!canSubmit.value) return;
  buildSubmitting.value = true;
  buildError.value = null;
  buildSuccess.value = false;
  try {
    await apiClient.post(`/stations/${stationId}/spacecrafts/build`, {
      orders: [{ spacecraftKey: ship.definition.key, amount: Math.floor(buildAmount.value) }],
    });
    buildSuccess.value = true;
    emit('built');
    setTimeout(() => {
      buildSuccess.value = false;
    }, 3000);
  } catch (error) {
    buildError.value = apiErrorMessage(error, 'Build order failed');
    setTimeout(() => {
      buildError.value = null;
    }, 4000);
  } finally {
    buildSubmitting.value = false;
  }
}
</script>

<template>
  <section class="ui-card" aria-label="Build spacecraft">
    <h3 class="ui-label">Build {{ ship.definition.name }}</h3>

    <div class="flex items-center gap-2">
      <div class="flex items-center gap-1" role="group" aria-label="Amount">
        <button
          type="button"
          class="ui-btn w-10 px-0"
          aria-label="Decrease amount"
          @click="buildAmount = Math.max(1, buildAmount - 1)"
        >
          −
        </button>
        <input
          v-model.number="buildAmount"
          type="number"
          min="1"
          step="1"
          aria-label="Amount"
          class="ui-input ui-num w-16 text-center"
          @change="buildAmount = Math.max(1, Math.floor(buildAmount || 1))"
        />
        <button
          type="button"
          class="ui-btn w-10 px-0"
          aria-label="Increase amount"
          @click="buildAmount = buildAmount + 1"
        >
          +
        </button>
        <button type="button" class="ui-btn" @click="setMaxAmount">Max</button>
      </div>
      <button
        type="button"
        class="ui-btn ui-btn-primary flex-1"
        :disabled="!canSubmit"
        @click="submitBuild"
      >
        <template v-if="buildSuccess">Queued ✓</template>
        <template v-else-if="buildSubmitting">Submitting…</template>
        <template v-else-if="playerResources === null">Loading…</template>
        <template v-else>Build {{ amount }}</template>
      </button>
    </div>

    <CostList
      :costs="totalCosts"
      :stock="playerResources"
      :duration="formatBuildTime(ship.definition.buildTime * amount)"
    />

    <div class="flex flex-col gap-1.5">
      <div class="flex items-baseline justify-between text-[13px]">
        <span class="text-ui-soft">
          Crew <span class="ui-num text-ui-bright">{{ crewNeeded }}</span>
        </span>
        <span class="text-ui-muted">
          Hangar
          <span class="ui-num" :class="exceedsCapacity ? 'text-ui-red' : 'text-ui-bright'"
            >{{ hangar.used + crewNeeded }} / {{ hangar.capacity }}</span
          >
        </span>
      </div>
      <div class="ui-bar flex">
        <div class="h-full bg-ui-soft/50" :style="{ width: `${hangarPercent(hangar.used)}%` }" />
        <div
          class="h-full"
          :class="exceedsCapacity ? 'bg-ui-red' : 'bg-ui-cyan'"
          :style="{ width: `${hangarPercent(crewNeeded)}%` }"
        />
      </div>
    </div>

    <p v-if="blocker" class="text-xs text-ui-amber">{{ blocker }}</p>
    <p v-if="buildError" class="text-xs text-ui-red">{{ buildError }}</p>
  </section>
</template>
