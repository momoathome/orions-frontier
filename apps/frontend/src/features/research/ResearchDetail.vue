<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { getBuilding, getResearchDefinition } from '@orions-frontier/game-config';
import {
  buildingKeys,
  getCostShortfall,
  QUEUE_LIMIT,
  researchKeys,
  type BuildingKey,
  type Requirements,
  type Station,
  type StationBuildingWithDefinition,
  type UserResourceSummary,
} from '@orions-frontier/shared';
import { apiErrorMessage } from '../../shared/api/api-client';
import {
  formatBlockers,
  formatBuildTime,
  formatCountdown,
  formatResearchEffect,
  formatShortfall,
} from '../../shared/lib/format';
import { live } from '../../shared/lib/live.js';
import { useResearchStore } from './store.js';
import ConfirmCancelButton from '../../shared/ui/ConfirmCancelButton.vue';
import CostList from '../../shared/ui/CostList.vue';
import QueueList from '../../shared/ui/QueueList.vue';
import { LANES, leaves } from './research-layout';

// Stations come in as props: research sits below the station feature and does not import it.
const { nodeId, stationId, stations, details } = defineProps<{
  nodeId: string | null;
  stationId: string;
  stations: readonly Station[];
  details: Readonly<
    Record<
      string,
      { buildings: StationBuildingWithDefinition[]; resources: UserResourceSummary | null }
    >
  >;
}>();
const emit = defineEmits<{ build: [section: 'fleet' | 'defense']; close: [] }>();
const research = useResearchStore();
// Pays from the open station until the player picks another one.
const chosenStationId = ref<string | null>(null);
const payingStationId = computed({
  get: () => chosenStationId.value ?? stationId,
  set: (value: string) => (chosenStationId.value = value),
});
const busy = ref(false);
const error = ref<string | null>(null);
watch(
  () => nodeId,
  () => (error.value = null)
);

const tech = computed(
  () =>
    research.state.research?.technologies.find((entry) => entry.definition.key === nodeId) ?? null
);
const leaf = computed(() => leaves.find((entry) => entry.id === nodeId) ?? null);
const now = computed(() => live.now);

// Research checks the account's highest building; ships and defenses the building station (E2).
const highestBuilding = (key: BuildingKey) =>
  Math.max(
    key === 'laboratory' ? (research.state.research?.highestLaboratory ?? 0) : 0,
    ...Object.values(details).map(
      (detail) => detail.buildings.find((b) => b.definition.key === key)?.level ?? 0
    )
  );
const stationBuilding = (key: BuildingKey) =>
  details[stationId]?.buildings.find((b) => b.definition.key === key)?.level ?? 0;

function requirementRows(requirements: Requirements, buildingLevel: (key: BuildingKey) => number) {
  return [
    ...researchKeys.flatMap((key) => {
      const level = requirements.research?.[key];
      return level === undefined
        ? []
        : [
            {
              id: key,
              research: true,
              label: `${getResearchDefinition(key)?.name ?? key} ${level}`,
              current: research.levels[key] ?? 0,
              level,
            },
          ];
    }),
    ...buildingKeys.flatMap((key) => {
      const level = requirements.buildings?.[key];
      return level === undefined
        ? []
        : [
            {
              id: key,
              research: false,
              label: `${getBuilding(key).name} ${level}`,
              current: buildingLevel(key),
              level,
            },
          ];
    }),
  ];
}

const requirements = computed(() => {
  const next = tech.value?.next;
  if (next) {
    // Every research level is capped by the Laboratory level, on top of the tier gate.
    const laboratory = Math.max(next.requirements.buildings?.laboratory ?? 0, next.level);
    return requirementRows(
      { ...next.requirements, buildings: { ...next.requirements.buildings, laboratory } },
      highestBuilding
    );
  }
  return leaf.value ? requirementRows(leaf.value.requirements, stationBuilding) : [];
});

const lane = computed(() => LANES.find((entry) => entry.key === tech.value?.definition.lane));
const effect = computed(() => {
  const value = tech.value;
  const definition = value?.definition;
  if (!value || !definition?.effect) return null;
  return {
    label: definition.effect.label,
    now: formatResearchEffect(definition.effect, value.level),
    next: value.next ? formatResearchEffect(definition.effect, value.next.level) : null,
  };
});

const running = computed(() => {
  const value = tech.value;
  if (!value?.completesAt) return null;
  const endsAt = Date.parse(value.completesAt);
  const startedAt = value.startedAt ? Date.parse(value.startedAt) : endsAt;
  return {
    endsAt,
    progress:
      endsAt > startedAt
        ? Math.min(100, Math.max(0, ((now.value - startedAt) / (endsAt - startedAt)) * 100))
        : 0,
  };
});

const payingStock = computed(() => details[payingStationId.value]?.resources ?? null);
const shortfall = computed(() => {
  const next = tech.value?.next;
  const stock = payingStock.value;
  return next && stock
    ? formatShortfall(getCostShortfall(next.costs, stock.resources, stock.rates))
    : null;
});

const queue = computed(() => research.state.research?.queue ?? []);
/** A new level waits in the queue while every slot is busy or an earlier level is still pending. */
const startsNow = computed(() => {
  const value = tech.value;
  const slots = research.state.research?.slots ?? 1;
  return value !== null && research.running.length < slots && value.queuedLevel === value.level;
});

const startLabel = computed(() => (startsNow.value ? 'Start research' : 'Add to queue'));

/** The exact reason the start button is disabled, in the order a player fixes it. */
const lockReason = computed(() => {
  const value = tech.value;
  if (!value?.next) return null;
  if (value.blockers.length > 0) return formatBlockers(value.blockers);
  // The server refuses a full queue even when the level would start at once.
  if (queue.value.length >= QUEUE_LIMIT) {
    return `Queue is full (${QUEUE_LIMIT} jobs)`;
  }
  return shortfall.value;
});

async function act(action: () => Promise<void>, fallback: string) {
  busy.value = true;
  error.value = null;
  try {
    await action();
  } catch (cause) {
    error.value = apiErrorMessage(cause, fallback);
  } finally {
    busy.value = false;
  }
}

const startResearch = () => {
  const key = tech.value?.definition.key;
  if (key)
    void act(
      () => research.startResearch(key, payingStationId.value),
      'Research could not be started'
    );
};
const removing = ref<string | null>(null);
const removeQueued = async (jobId: string) => {
  // Not through act(): `busy` would relabel the start button as "Starting…".
  removing.value = jobId;
  error.value = null;
  try {
    await research.removeQueued(jobId);
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Queue entry could not be removed');
  } finally {
    removing.value = null;
  }
};
const cancelResearch = () => {
  const key = tech.value?.definition.key;
  if (key) void act(() => research.cancelResearch(key), 'Research could not be cancelled');
};

const shipStats = computed(() => {
  const value = leaf.value;
  if (value?.kind !== 'ship') return [];
  const { ship } = value;
  return [
    { label: 'Attack', value: ship.attack },
    { label: 'Defense', value: ship.defense },
    { label: 'Speed', value: ship.speed },
    { label: 'Cargo', value: ship.cargo },
    { label: 'Mining', value: ship.miningRate },
    { label: 'Crew', value: ship.crew },
  ].filter((stat) => stat.value > 0);
});
</script>

<template>
  <aside
    class="flex flex-col gap-4 overflow-y-auto border-ui-line bg-ui-panel p-5 text-sm"
    aria-label="Research details"
  >
    <p v-if="!tech && !leaf" class="text-ui-muted">
      Select a research to see what it does, what it needs and what it costs.
    </p>

    <template v-if="tech">
      <header class="flex items-start justify-between gap-3">
        <div class="flex flex-col gap-1">
          <span class="ui-label">Tier {{ tech.definition.tier }} {{ lane?.label }}</span>
          <h3 class="text-lg font-semibold text-ui-bright">{{ tech.definition.name }}</h3>
          <span class="ui-num text-[13px] text-ui-muted"
            >Level {{ tech.level }} of {{ tech.definition.maxLevel
            }}<span v-if="tech.queuedLevel > tech.level" class="text-ui-amber">
              · queued to {{ tech.queuedLevel }}</span
            ></span
          >
        </div>
        <button
          type="button"
          class="ui-btn ui-btn-icon sm:hidden"
          aria-label="Close details"
          @click="emit('close')"
        >
          ✕
        </button>
      </header>
      <p class="text-[13px] text-ui-soft">{{ tech.definition.description }}</p>

      <div v-if="effect" class="flex items-baseline gap-2 text-[13px] text-ui-soft">
        <span>{{ effect.label }}</span>
        <span class="ui-num text-ui-bright">{{ effect.now }}</span>
        <template v-if="effect.next">
          <span class="text-ui-dim">→</span>
          <span class="ui-num font-semibold text-ui-green">{{ effect.next }}</span>
        </template>
      </div>
    </template>

    <template v-else-if="leaf">
      <header class="flex items-start justify-between gap-3">
        <div class="flex flex-col gap-1">
          <span class="ui-label">{{ leaf.kind === 'ship' ? 'Spacecraft' : 'Defense' }}</span>
          <h3 class="text-lg font-semibold text-ui-bright">{{ leaf.name }}</h3>
        </div>
        <button
          type="button"
          class="ui-btn ui-btn-icon sm:hidden"
          aria-label="Close details"
          @click="emit('close')"
        >
          ✕
        </button>
      </header>
      <p class="text-[13px] text-ui-soft">
        {{ leaf.kind === 'ship' ? leaf.ship.description : leaf.upgrade.description }}
      </p>
      <dl v-if="shipStats.length > 0" class="grid grid-cols-3 gap-2 text-xs text-ui-muted">
        <div v-for="stat in shipStats" :key="stat.label" class="flex flex-col">
          <dt>{{ stat.label }}</dt>
          <dd class="ui-num text-sm text-ui-bright">{{ stat.value }}</dd>
        </div>
      </dl>
      <CostList v-if="leaf.kind === 'ship'" :costs="leaf.ship.costs" />
    </template>

    <section v-if="requirements.length > 0" class="flex flex-col gap-1.5">
      <h4 class="ui-label">
        {{ tech?.next ? `Requirements for level ${tech.next.level}` : 'Requirements' }}
      </h4>
      <ul class="flex flex-col gap-1 text-[13px]">
        <li v-for="row in requirements" :key="row.id" class="flex items-baseline gap-2">
          <span
            :class="row.current >= row.level ? 'text-ui-green' : 'text-ui-red'"
            :aria-label="row.current >= row.level ? 'met' : 'missing'"
            >{{ row.current >= row.level ? '✓' : '✗' }}</span
          >
          <button
            v-if="row.research"
            type="button"
            class="text-left text-ui-text hover:text-ui-cyan hover:underline"
            @click="research.openView(row.id)"
          >
            {{ row.label }}
          </button>
          <span v-else class="text-ui-text">{{ row.label }}</span>
          <span class="ui-num ml-auto text-xs text-ui-dim">now {{ row.current }}</span>
        </li>
      </ul>
    </section>

    <template v-if="tech">
      <section v-if="running" class="flex flex-col gap-2">
        <div class="ui-bar">
          <div
            class="h-full rounded-full bg-ui-amber transition-[width] duration-1000 ease-linear"
            :style="{ width: `${running.progress}%` }"
          />
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-[13px] text-ui-soft">
            Level {{ tech.level + 1 }} done in
            <strong class="ui-num text-ui-amber">{{ formatCountdown(running.endsAt, now) }}</strong>
          </span>
          <ConfirmCancelButton :busy="busy" @confirm="cancelResearch" />
        </div>
      </section>

      <section v-if="tech.next" class="flex flex-col gap-2.5">
        <h4 class="ui-label">Cost and duration</h4>
        <CostList
          :costs="tech.next.costs"
          :stock="payingStock?.resources"
          :duration="formatBuildTime(tech.next.durationSeconds)"
        />
        <label v-if="stations.length > 1" class="flex flex-col gap-1">
          <span class="text-xs text-ui-muted">Paid by</span>
          <select v-model="payingStationId" class="ui-input">
            <option v-for="station in stations" :key="station.id" :value="station.id">
              {{ station.name }}
            </option>
          </select>
        </label>
        <button
          type="button"
          class="ui-btn"
          :class="{ 'ui-btn-primary': !lockReason }"
          :disabled="lockReason !== null || busy"
          @click="startResearch"
        >
          {{ busy ? 'Starting…' : startLabel }}
        </button>
        <p v-if="lockReason" class="text-xs text-ui-amber">{{ lockReason }}</p>
      </section>

      <p v-else-if="!running" class="text-[13px] text-ui-green">Max level reached.</p>
    </template>

    <QueueList :jobs="queue" :busy-id="removing" @remove="removeQueued" />

    <button
      v-if="leaf"
      type="button"
      class="ui-btn"
      @click="emit('build', leaf.kind === 'ship' ? 'fleet' : 'defense')"
    >
      {{ leaf.kind === 'ship' ? 'Build at Shipyard' : 'Open Defense' }}
    </button>

    <p v-if="error" class="ui-error">{{ error }}</p>
  </aside>
</template>
