<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  useOverviewStore,
  type AlertTone,
  type Operation,
  type StationSection,
} from '../stores/overview.js';
import { useResearchStore } from '../stores/research.js';
import { formatAgo, formatCountdown } from '../lib/format.js';

const { activeStationId } = defineProps<{ activeStationId: string }>();
const emit = defineEmits<{
  open: [stationId: string, section: StationSection | null];
  logbook: [];
}>();
const overview = useOverviewStore();
const research = useResearchStore();

// Caps keep the column readable with many stations; the rest is one click away.
const ALERT_LIMIT = 4;
const STATION_LIMIT = 5;
const OPERATION_LIMIT = 6;
const showAllAlerts = ref(false);
const showAllStations = ref(false);
const showAllOperations = ref(false);

const now = computed(() => overview.state.now);
const alerts = computed(() =>
  showAllAlerts.value ? overview.alerts : overview.alerts.slice(0, ALERT_LIMIT)
);
const stations = computed(() => {
  const sorted = [...overview.state.stations].sort(
    (a, b) => Number(b.id === activeStationId) - Number(a.id === activeStationId)
  );
  return showAllStations.value ? sorted : sorted.slice(0, STATION_LIMIT);
});
const operations = computed(() =>
  showAllOperations.value ? overview.operations : overview.operations.slice(0, OPERATION_LIMIT)
);
const recent = computed(() => overview.unseenLogbook.slice(0, 4));
const multiStation = computed(() => overview.state.stations.length > 1);

const ALERT_STYLE: Record<AlertTone, string> = {
  danger: 'border-[#6b2f2c] bg-[#2a1214] text-ui-red',
  warning: 'border-[#5a4317] bg-[#1d170b] text-ui-amber',
  info: 'border-[#1f5b66] bg-[#0c2026] text-ui-cyan',
};
const OPERATION_DOT: Record<Operation['kind'], string> = {
  outbound: 'bg-ui-blue',
  mining: 'bg-ui-amber animate-pulse',
  returning: 'bg-ui-orange',
  mission: 'bg-ui-purple',
  build: 'bg-ui-cyan',
  research: 'bg-ui-green',
};

function openOperation(op: Operation) {
  if (op.kind === 'research') research.openView(op.research);
  else emit('open', op.stationId, op.section);
}

function queueLabel(stationId: string): string {
  const queue = overview.stationQueue(stationId);
  if (queue.count === 0) return 'Idle';
  return `${queue.count} (${formatCountdown(queue.nextEndsAt ?? now.value, now.value)})`;
}
</script>

<template>
  <aside
    class="flex w-80 shrink-0 flex-col gap-6 overflow-y-auto border-r border-ui-line bg-ui-panel p-4 text-left text-sm text-ui-text"
    aria-label="Situation overview"
  >
    <section v-if="overview.alerts.length > 0" class="flex flex-col gap-2">
      <h2 class="ui-label">Needs attention</h2>
      <button
        v-for="alert in alerts"
        :key="alert.key"
        type="button"
        class="flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition hover:brightness-125"
        :class="ALERT_STYLE[alert.tone]"
        @click="emit('open', alert.stationId, alert.section)"
      >
        <span class="font-semibold">{{ alert.title }}</span>
        <span class="text-[13px] text-ui-soft">{{ alert.detail }}</span>
      </button>
      <button
        v-if="overview.alerts.length > ALERT_LIMIT"
        type="button"
        class="self-start text-[13px] text-ui-cyan hover:text-ui-bright"
        @click="showAllAlerts = !showAllAlerts"
      >
        {{ showAllAlerts ? 'Show less' : `+${overview.alerts.length - ALERT_LIMIT} more` }}
      </button>
    </section>

    <section class="flex flex-col gap-2">
      <h2 class="ui-label">
        {{ multiStation ? `Stations (${overview.state.stations.length})` : 'Station' }}
      </h2>
      <template v-for="station in stations" :key="station.id">
        <!-- The active station gets the full card, others one compact row. -->
        <button
          v-if="station.id === activeStationId"
          type="button"
          class="ui-card text-left transition hover:border-ui-line-strong"
          :class="multiStation ? 'border-[#1f5b66]' : ''"
          @click="emit('open', station.id, null)"
        >
          <div class="flex items-baseline justify-between gap-2">
            <span class="truncate text-base font-semibold text-ui-bright">{{ station.name }}</span>
            <span
              class="ui-num text-[13px]"
              :class="station.integrity < 100 ? 'text-ui-red' : 'text-ui-green'"
              >{{ station.integrity }}%</span
            >
          </div>
          <dl class="grid grid-cols-3 gap-2 text-xs text-ui-muted">
            <div class="flex flex-col gap-0.5">
              <dt>Fleet</dt>
              <dd class="ui-num text-sm text-ui-text">
                {{ overview.stationFleet(station.id).total }}
              </dd>
            </div>
            <div class="flex flex-col gap-0.5">
              <dt>Storage</dt>
              <dd
                class="ui-num text-sm"
                :class="
                  overview.stationStorage(station.id).fill >= 0.9 ? 'text-ui-amber' : 'text-ui-text'
                "
              >
                {{ Math.round(overview.stationStorage(station.id).fill * 100) }}%
              </dd>
            </div>
            <div class="flex flex-col gap-0.5">
              <dt>Queue</dt>
              <dd
                class="ui-num text-sm"
                :class="
                  overview.stationQueue(station.id).count > 0 ? 'text-ui-amber' : 'text-ui-dim'
                "
              >
                {{ queueLabel(station.id) }}
              </dd>
            </div>
          </dl>
        </button>
        <button
          v-else
          type="button"
          class="flex items-center justify-between gap-3 rounded-lg border border-ui-line px-3 py-2.5 text-left transition hover:border-ui-line-strong hover:bg-ui-card"
          :title="`Switch to ${station.name}`"
          @click="emit('open', station.id, null)"
        >
          <span class="min-w-0 truncate">{{ station.name }}</span>
          <span
            class="ui-num shrink-0 text-[13px]"
            :class="overview.stationQueue(station.id).count > 0 ? 'text-ui-amber' : 'text-ui-dim'"
            >{{ queueLabel(station.id) }}</span
          >
        </button>
      </template>
      <button
        v-if="overview.state.stations.length > STATION_LIMIT"
        type="button"
        class="self-start text-[13px] text-ui-cyan hover:text-ui-bright"
        @click="showAllStations = !showAllStations"
      >
        {{ showAllStations ? 'Show less' : `Show all (${overview.state.stations.length})` }}
      </button>
    </section>

    <section class="flex flex-col gap-1">
      <h2 class="ui-label mb-1">Operations by completion</h2>
      <p v-if="overview.operations.length === 0" class="text-[13px] text-ui-dim">
        Nothing running. Assign miners or start an upgrade.
      </p>
      <button
        v-for="op in operations"
        :key="op.id"
        type="button"
        class="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-ui-card"
        @click="openOperation(op)"
      >
        <span class="h-2 w-2 shrink-0 rounded-full" :class="OPERATION_DOT[op.kind]" />
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-ui-bright">{{ op.title }}</span>
          <span class="truncate text-xs text-ui-muted">{{ op.detail }}</span>
        </span>
        <span class="ui-num shrink-0 text-sm text-ui-text">{{
          formatCountdown(op.endsAt, now)
        }}</span>
      </button>
      <button
        v-if="overview.operations.length > OPERATION_LIMIT"
        type="button"
        class="self-start text-[13px] text-ui-cyan hover:text-ui-bright"
        @click="showAllOperations = !showAllOperations"
      >
        {{ showAllOperations ? 'Show less' : `Show all (${overview.operations.length})` }}
      </button>
    </section>

    <section v-if="recent.length > 0" class="flex flex-col gap-2">
      <h2 class="ui-label">Since your last visit</h2>
      <ul class="flex flex-col gap-2">
        <li v-for="entry in recent" :key="entry.id" class="flex flex-col">
          <span class="text-[13px] text-ui-text">{{ entry.summary }}</span>
          <span class="text-xs text-ui-dim">
            {{ formatAgo(Date.parse(entry.occurredAt), now) }}
            <template v-if="multiStation && entry.stationId">
              at {{ overview.stationName(entry.stationId) }}
            </template>
          </span>
        </li>
      </ul>
      <button
        type="button"
        class="self-start text-[13px] text-ui-cyan hover:text-ui-bright"
        @click="emit('logbook')"
      >
        Open logbook ({{ overview.unseenLogbook.length }} new)
      </button>
    </section>
  </aside>
</template>
