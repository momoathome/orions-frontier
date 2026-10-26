<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import type { LogbookEntry, LogbookEntryType } from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../lib/api-client';
import { wsClient } from '../lib/ws-client';

const { stationId } = defineProps<{ stationId: string }>();
const entries = ref<LogbookEntry[]>([]);
const loaded = ref(false);
const error = ref<string | null>(null);

const TYPE_STYLE: Record<LogbookEntryType, { label: string; dot: string }> = {
  building_completed: { label: 'Building', dot: 'bg-cyan-400' },
  defense_completed: { label: 'Defense', dot: 'bg-sky-400' },
  spacecraft_completed: { label: 'Shipyard', dot: 'bg-indigo-400' },
  research_completed: { label: 'Research', dot: 'bg-green-400' },
  world_mission_completed: { label: 'Mission', dot: 'bg-amber-300' },
  colony_established: { label: 'Colony', dot: 'bg-amber-400' },
  combat_resolved: { label: 'Attack', dot: 'bg-rose-400' },
  combat_defended: { label: 'Defense', dot: 'bg-rose-500' },
  loot_delivered: { label: 'Loot', dot: 'bg-orange-400' },
  salvage_completed: { label: 'Salvage', dot: 'bg-teal-400' },
};

const timeline = computed(() =>
  entries.value.map((entry) => ({
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

async function load(): Promise<void> {
  try {
    entries.value = await apiClient.get<LogbookEntry[]>('/me/logbook', { params: { limit: 100 } });
    error.value = null;
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Logbook could not be loaded');
  } finally {
    loaded.value = true;
  }
}

// Completion events arrive in bursts; one reload after the burst is enough.
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleLoad(): void {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    void load();
  }, 500);
}

void load();
const unsubscribers = [
  wsClient.on('building_upgrade_completed', scheduleLoad),
  wsClient.on('defense_upgrade_completed', scheduleLoad),
  wsClient.on('spacecraft_build_completed', scheduleLoad),
  wsClient.on('world_mission_completed', scheduleLoad),
  wsClient.on('transport_tick_completed', scheduleLoad),
];
onUnmounted(() => {
  if (reloadTimer) clearTimeout(reloadTimer);
  for (const unsubscribe of unsubscribers) unsubscribe();
});
</script>

<template>
  <div class="flex h-full flex-col overflow-y-auto p-4 font-mono text-[10px]">
    <p v-if="error" class="mb-2 text-rose-300/70">{{ error }}</p>
    <p
      v-if="loaded && !error && timeline.length === 0"
      class="m-auto text-[9px] uppercase tracking-widest text-white/20"
    >
      No entries yet
    </p>
    <ol class="relative ml-1.5 border-l border-white/10">
      <li v-for="entry in timeline" :key="entry.id" class="relative pb-3 pl-4">
        <span class="absolute -left-[4.5px] top-1 h-2 w-2 rounded-full" :class="entry.style.dot" />
        <div class="flex items-baseline gap-3" :class="entry.otherStation ? 'opacity-50' : ''">
          <time class="shrink-0 tabular-nums text-white/30" :datetime="entry.occurredAt">
            {{ entry.time }}
          </time>
          <span class="w-16 shrink-0 uppercase tracking-widest text-[8px] text-white/35">
            {{ entry.style.label }}
          </span>
          <span class="text-white/75">{{ entry.summary }}</span>
          <span v-if="entry.otherStation" class="text-[8px] uppercase text-white/30">
            other station
          </span>
        </div>
      </li>
    </ol>
  </div>
</template>
