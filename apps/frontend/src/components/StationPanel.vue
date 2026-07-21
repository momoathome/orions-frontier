<script setup lang="ts">
import { ref, computed } from 'vue';
import BuildingsTab from './BuildingsTab.vue';
import FleetTab from './FleetTab.vue';
import LogisticsTab from './LogisticsTab.vue';
import FrontierTab from './FrontierTab.vue';
import ResearchTab from './ResearchTab.vue';
import DefenseTab from './DefenseTab.vue';
type Section = 'buildings' | 'fleet' | 'logistics' | 'research' | 'frontier' | 'defense';

const { stationId, stationName } = defineProps<{
  stationId: string;
  stationName?: string;
}>();

const emit = defineEmits<{ close: [] }>();

const selectedSection = ref<Section | null>('logistics');
const buildingsQueueCount = ref(0);
const fleetQueueCount = ref(0);
const totalQueue = computed(() => buildingsQueueCount.value + fleetQueueCount.value);
</script>

<template>
  <div
    class="absolute bottom-0 left-0 w-full cursor-default z-20 flex flex-col font-mono min-h-85 h-[clamp(340px,36vh,520px)]"
  >
    <!-- Panel background -->
    <div class="absolute inset-0 bg-[#060c1b]/97 backdrop-blur-xl border-t-2 border-cyan-500/40" />
    <!-- Scanlines -->
    <div class="scanlines absolute inset-0 pointer-events-none z-10 opacity-[0.025]" />
    <!-- Corner accents -->
    <div class="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-cyan-400/50 z-10" />
    <div class="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cyan-400/50 z-10" />

    <!-- Content -->
    <div class="relative z-20 flex flex-col h-full">
      <div
        class="flex items-center justify-between px-5 h-11 border-b border-white/[0.07] shrink-0"
      >
        <div class="flex items-center gap-5">
          <div class="flex items-center gap-2.5">
            <span class="text-[9px] text-cyan-400/30 uppercase tracking-[0.4em]">Station</span>
            <span class="text-sm font-semibold tracking-widest text-white">
              {{ stationName ?? 'OMEGA PRIME' }}
            </span>
          </div>
          <div class="hidden md:flex items-center gap-4 text-[10px]">
            <div class="flex items-center gap-1.5">
              <span
                class="w-1 h-1 rounded-full bg-amber-400/70"
                :class="totalQueue > 0 ? 'animate-pulse' : 'opacity-30'"
              />
              <span class="text-white/25">Queue</span>
              <span
                class="tabular-nums"
                :class="totalQueue > 0 ? 'text-amber-300' : 'text-white/25'"
                >{{ totalQueue }} active</span
              >
            </div>
          </div>
        </div>
        <button
          @click="emit('close')"
          class="w-7 h-7 flex items-center justify-center rounded text-white/60 hover:text-white/80 hover:bg-white/5 transition text-[11px]"
        >
          ✕
        </button>
      </div>

      <div
        class="flex items-center gap-0.5 px-4 h-8 border-b border-white/5 bg-[#040911]/60 shrink-0"
      >
        <button
          v-for="tab in [
            'buildings',
            'fleet',
            'logistics',
            'research',
            'frontier',
            'defense',
          ] as Section[]"
          :key="tab"
          @click="selectedSection = tab"
          class="px-3 h-5 rounded text-[9px] uppercase tracking-[0.25em] transition"
          :class="
            selectedSection === tab
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/35'
              : 'text-white/25 hover:text-white/55 hover:bg-white/4'
          "
        >
          {{ tab }}
        </button>
      </div>

      <div v-if="!selectedSection" class="flex-1 flex items-center justify-center">
        <div class="text-center">
          <div class="text-xl text-cyan-500/15 mb-2 tracking-[0.6em]">◎</div>
          <p class="text-white/15 text-[9px] uppercase tracking-[0.4em]">Select a command module</p>
        </div>
      </div>

      <BuildingsTab
        v-if="selectedSection === 'buildings'"
        :station-id="stationId"
        class="flex-1 overflow-hidden flex flex-col"
        @queue-count="buildingsQueueCount = $event"
      />
      <FleetTab
        v-if="selectedSection === 'fleet'"
        :station-id="stationId"
        class="flex-1 overflow-hidden flex flex-col"
        @queue-count="fleetQueueCount = $event"
      />
      <LogisticsTab
        v-show="selectedSection === 'logistics'"
        :station-id="stationId"
        class="flex-1 overflow-hidden flex flex-col"
      />
      <FrontierTab
        v-if="selectedSection === 'frontier'"
        :station-id="stationId"
        class="flex-1 overflow-hidden"
      />
      <ResearchTab
        v-if="selectedSection === 'research'"
        :station-id="stationId"
        class="flex-1 overflow-hidden"
      />
      <DefenseTab
        v-if="selectedSection === 'defense'"
        :station-id="stationId"
        class="flex-1 overflow-hidden"
      />
    </div>
  </div>
</template>

<style scoped>
.scanlines {
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 1) 2px,
    rgba(0, 0, 0, 1) 4px
  );
}
</style>
