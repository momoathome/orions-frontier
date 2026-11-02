<script setup lang="ts">
import { computed, ref } from 'vue';
import type { LogbookEntryType } from '@orions-frontier/shared';
import LoadMoreButton from '../../shared/ui/LoadMoreButton.vue';
import { CombatReportDetail } from '../combat/index.js';
import { useStationStore } from '../station/index.js';
import { useLogbookStore } from './store.js';

const { stationId } = defineProps<{ stationId: string }>();
const logbook = useLogbookStore();
const stationStore = useStationStore();
// The store keeps the logbook current; reload once on open for entries no event announces.
const loaded = ref(false);
void logbook.refreshLogbook().then(() => (loaded.value = true));

const TYPE_STYLE: Record<LogbookEntryType, { label: string; dot: string }> = {
  building_completed: { label: 'Building', dot: 'bg-cyan-400' },
  defense_completed: { label: 'Defense', dot: 'bg-sky-400' },
  spacecraft_completed: { label: 'Shipyard', dot: 'bg-indigo-400' },
  miners_assigned: { label: 'Mining', dot: 'bg-yellow-300' },
  research_completed: { label: 'Research', dot: 'bg-green-400' },
  queue_job_dropped: { label: 'Queue', dot: 'bg-slate-400' },
  world_mission_completed: { label: 'Mission', dot: 'bg-amber-300' },
  colony_established: { label: 'Colony', dot: 'bg-amber-400' },
  combat_resolved: { label: 'Attack', dot: 'bg-rose-400' },
  combat_defended: { label: 'Defense', dot: 'bg-rose-500' },
  loot_delivered: { label: 'Loot', dot: 'bg-orange-400' },
  salvage_completed: { label: 'Salvage', dot: 'bg-teal-400' },
};

const FILTERS = {
  all: { label: 'All', types: null },
  combat: { label: 'Combat', types: ['combat_resolved', 'combat_defended', 'loot_delivered'] },
  construction: {
    label: 'Construction',
    types: ['building_completed', 'defense_completed', 'queue_job_dropped'],
  },
  fleet: {
    label: 'Fleet',
    types: ['spacecraft_completed', 'miners_assigned', 'salvage_completed'],
  },
  research: { label: 'Research', types: ['research_completed'] },
  missions: { label: 'Missions', types: ['world_mission_completed', 'colony_established'] },
} satisfies Record<string, { label: string; types: LogbookEntryType[] | null }>;
type Filter = keyof typeof FILTERS;
const filter = ref<Filter>('all');
const openCombatId = ref<string | null>(null);
const FRAME = 'flex h-[min(560px,calc(85vh-8rem))] flex-col gap-3 text-sm';

const timeline = computed(() =>
  logbook.state.logbook
    .filter((entry) => {
      const types: readonly LogbookEntryType[] | null = FILTERS[filter.value].types;
      return types === null || types.includes(entry.type);
    })
    .map((entry) => ({
      ...entry,
      style: TYPE_STYLE[entry.type],
      otherStation: entry.stationId !== null && entry.stationId !== stationId,
      time: new Date(entry.occurredAt).toLocaleString(undefined, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    }))
);
</script>

<template>
  <!-- One fixed height for every tab and the report, so the centered modal never jumps. -->
  <div v-if="openCombatId" :class="FRAME">
    <button type="button" class="ui-btn shrink-0 self-start" @click="openCombatId = null">
      ← Back to logbook
    </button>
    <div class="min-h-0 flex-1 overflow-y-auto pr-1">
      <CombatReportDetail :combat-id="openCombatId" />
    </div>
  </div>
  <div v-else :class="FRAME">
    <nav
      class="flex shrink-0 gap-1 overflow-x-auto border-b border-ui-line pb-3"
      aria-label="Logbook filter"
    >
      <button
        v-for="(option, key) in FILTERS"
        :key="key"
        type="button"
        class="ui-tab"
        :class="{ 'ui-tab-active': filter === key }"
        :aria-pressed="filter === key"
        @click="filter = key"
      >
        {{ option.label }}
      </button>
    </nav>
    <p
      v-if="loaded && timeline.length === 0"
      class="m-auto text-xs uppercase tracking-[0.08em] text-ui-dim"
    >
      No entries yet
    </p>
    <!-- Scrolls outside the list: overflow on the <ol> would clip the dots on its left edge. -->
    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <ol class="relative ml-1.5 border-l border-ui-line-strong">
        <li v-for="entry in timeline" :key="entry.id" class="relative pb-3 pl-4">
          <span
            class="absolute -left-[4.5px] top-1 h-2 w-2 rounded-full"
            :class="entry.style.dot"
          />
          <component
            :is="entry.combatId ? 'button' : 'div'"
            :type="entry.combatId ? 'button' : undefined"
            class="flex w-full items-baseline gap-3 text-left"
            :class="{ 'group cursor-pointer': entry.combatId }"
            @click="entry.combatId && (openCombatId = entry.combatId)"
          >
            <time class="shrink-0 tabular-nums text-ui-muted" :datetime="entry.occurredAt">
              {{ entry.time }}
            </time>
            <span class="w-16 shrink-0 uppercase tracking-[0.08em] text-xs text-ui-muted">
              {{ entry.style.label }}
            </span>
            <span class="text-ui-text" :class="{ 'group-hover:text-ui-bright': entry.combatId }">
              {{ entry.summary }}
            </span>
            <span v-if="entry.otherStation" class="shrink-0 text-xs text-ui-muted">
              {{ stationStore.stationName(entry.stationId ?? '') }}
            </span>
            <span v-if="entry.combatId" class="ml-auto shrink-0 text-xs text-ui-cyan"
              >Report ›</span
            >
          </component>
        </li>
      </ol>
    </div>
    <LoadMoreButton v-if="logbook.hasOlderLogbook()" :load="logbook.loadOlderLogbook" />
  </div>
</template>
