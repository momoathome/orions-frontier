<script setup lang="ts">
import { computed } from 'vue';
import BuildingsTab from './BuildingsTab.vue';
import FleetTab from './FleetTab.vue';
import LogisticsTab from './LogisticsTab.vue';
import FrontierTab from './FrontierTab.vue';
import DefenseTab from './DefenseTab.vue';
import PanelShell from './PanelShell.vue';
import { stationSections, useOverviewStore, type StationSection } from '../stores/overview.js';
import { formatCountdown } from '../lib/format.js';

const { stationId } = defineProps<{ stationId: string }>();
const section = defineModel<StationSection>('section', { default: 'buildings' });
const emit = defineEmits<{ close: [] }>();
const overview = useOverviewStore();

const LABELS: Record<StationSection, string> = {
  buildings: 'Buildings',
  fleet: 'Fleet',
  logistics: 'Logistics',
  frontier: 'Frontier',
  defense: 'Defense',
};

// Read from the shared overview so the queue is right before any tab was opened.
const queue = computed(() => overview.stationQueue(stationId));
const integrity = computed(
  () => overview.state.stations.find((station) => station.id === stationId)?.integrity
);
const hangar = computed(() => overview.state.details[stationId]?.fleet?.hangar ?? null);
</script>

<template>
  <PanelShell
    label="Station details"
    eyebrow="Station"
    :title="overview.stationName(stationId)"
    wide
    @close="emit('close')"
  >
    <template #header>
      <dl class="grid grid-cols-3 gap-2 text-xs text-ui-muted">
        <div class="flex flex-col gap-0.5">
          <dt>Integrity</dt>
          <dd
            class="ui-num text-[15px]"
            :class="integrity !== undefined && integrity < 100 ? 'text-ui-red' : 'text-ui-green'"
          >
            {{ integrity ?? '—' }}%
          </dd>
        </div>
        <div class="flex flex-col gap-0.5">
          <dt>Crew slots</dt>
          <dd class="ui-num text-[15px] text-ui-bright">
            {{ hangar ? `${hangar.used} / ${hangar.capacity}` : '—' }}
          </dd>
        </div>
        <div class="flex flex-col gap-0.5">
          <dt>Queue</dt>
          <dd class="ui-num text-[15px]" :class="queue.count > 0 ? 'text-ui-amber' : 'text-ui-dim'">
            <template v-if="queue.count > 0 && queue.nextEndsAt">
              {{ queue.count }} ({{ formatCountdown(queue.nextEndsAt, overview.state.now) }})
            </template>
            <template v-else>Idle</template>
          </dd>
        </div>
      </dl>
      <nav class="flex flex-wrap gap-1" aria-label="Station sections">
        <button
          v-for="tab in stationSections"
          :key="tab"
          type="button"
          class="ui-tab"
          :class="{ 'ui-tab-active': section === tab }"
          :aria-current="section === tab ? 'page' : undefined"
          @click="section = tab"
        >
          {{ LABELS[tab] }}
        </button>
      </nav>
    </template>

    <BuildingsTab
      v-if="section === 'buildings'"
      :station-id="stationId"
      class="flex flex-1 flex-col overflow-hidden"
    />
    <FleetTab
      v-if="section === 'fleet'"
      :station-id="stationId"
      class="flex flex-1 flex-col overflow-hidden"
    />
    <LogisticsTab
      v-if="section === 'logistics'"
      :station-id="stationId"
      class="flex flex-1 flex-col overflow-hidden"
    />
    <FrontierTab
      v-if="section === 'frontier'"
      :station-id="stationId"
      class="flex-1 overflow-hidden"
    />
    <DefenseTab
      v-if="section === 'defense'"
      :station-id="stationId"
      class="flex-1 overflow-hidden"
    />
  </PanelShell>
</template>
