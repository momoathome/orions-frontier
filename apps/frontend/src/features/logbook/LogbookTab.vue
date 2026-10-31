<script setup lang="ts">
import { computed, ref } from 'vue';
import type { LogbookEntryType } from '@orions-frontier/shared';
import { useOverviewStore } from '../stores/overview.js';

const { stationId } = defineProps<{ stationId: string }>();
const overview = useOverviewStore();
// The store keeps the logbook current; reload once on open for entries no event announces.
const loaded = ref(false);
void overview.refreshLogbook().then(() => (loaded.value = true));

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

const timeline = computed(() =>
  overview.state.logbook.map((entry) => ({
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
  <div class="flex flex-col text-sm">
    <p
      v-if="loaded && timeline.length === 0"
      class="m-auto text-xs uppercase tracking-[0.08em] text-ui-dim"
    >
      No entries yet
    </p>
    <ol class="relative ml-1.5 border-l border-ui-line-strong">
      <li v-for="entry in timeline" :key="entry.id" class="relative pb-3 pl-4">
        <span class="absolute -left-[4.5px] top-1 h-2 w-2 rounded-full" :class="entry.style.dot" />
        <div class="flex items-baseline gap-3">
          <time class="shrink-0 tabular-nums text-ui-muted" :datetime="entry.occurredAt">
            {{ entry.time }}
          </time>
          <span class="w-16 shrink-0 uppercase tracking-[0.08em] text-xs text-ui-muted">
            {{ entry.style.label }}
          </span>
          <span class="text-ui-text">{{ entry.summary }}</span>
          <span v-if="entry.otherStation" class="shrink-0 text-xs text-ui-muted">
            {{ overview.stationName(entry.stationId ?? '') }}
          </span>
        </div>
      </li>
    </ol>
  </div>
</template>
