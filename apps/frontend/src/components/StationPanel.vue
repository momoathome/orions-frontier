<script setup lang="ts">
import { ref } from 'vue';
import { apiClient } from '../lib/api-client';
import type { StationSpacecraftWithDefinition, SpacecraftRole } from '@orions-frontier/shared';

type Section = 'buildings' | 'fleet' | 'mining' | 'defense';

const props = defineProps<{
  stationId: string;
  stationName?: string;
}>();

const emit = defineEmits<{ close: [] }>();

const selectedSection = ref<Section | null>(null);
const selectedBuilding = ref<any | null>(null);

// ── Fleet ────────────────────────────────────────────────────────────────────
const fleet = ref<StationSpacecraftWithDefinition[]>([]);
const fleetLoading = ref(false);
const fleetError = ref<string | null>(null);

async function loadFleet() {
  if (fleet.value.length > 0) return;
  fleetLoading.value = true;
  fleetError.value = null;
  try {
    const { data } = await apiClient.get(`/stations/${props.stationId}/spacecrafts`);
    fleet.value = data.data.spacecrafts;
  } catch {
    fleetError.value = 'Failed to load fleet data';
  } finally {
    fleetLoading.value = false;
  }
}

// ── Buildings (static for now) ───────────────────────────────────────────────
const buildings = ref([
  {
    id: 1, name: 'Core', level: 12, nextLevel: 13,
    description: 'Expands overall station capacity and resource throughput.',
    buildTime: '2m 14s', queued: true, progress: 65,
    costs: [{ name: 'Metal', amount: '12,000' }, { name: 'Crystal', amount: '8,000' }],
  },
  {
    id: 2, name: 'Hangar', level: 8, nextLevel: 9,
    description: 'Increases fleet capacity and reduces docking time by 15%.',
    buildTime: '4m 51s', queued: false, progress: 0,
    costs: [{ name: 'Metal', amount: '22,000' }, { name: 'Crystal', amount: '16,000' }],
  },
  {
    id: 3, name: 'Scanner', level: 5, nextLevel: 6,
    description: 'Extends detection range for asteroids and hostile ships.',
    buildTime: '1m 33s', queued: false, progress: 0,
    costs: [{ name: 'Metal', amount: '8,000' }, { name: 'Crystal', amount: '4,000' }],
  },
  {
    id: 4, name: 'Defense Grid', level: 3, nextLevel: 4,
    description: 'Upgrades station turrets and shielding systems.',
    buildTime: '6m 12s', queued: false, progress: 0,
    costs: [{ name: 'Metal', amount: '31,000' }, { name: 'Crystal', amount: '18,000' }],
  },
]);

const activeBuilding = ref<any>(buildings.value[0]);

function setSection(s: Section) {
  selectedSection.value = s;
  if (s === 'buildings') activeBuilding.value = buildings.value[0];
  if (s === 'fleet') loadFleet();
}

// ── Role theming ─────────────────────────────────────────────────────────────
type RoleTheme = { topBar: string; badge: string; badgeText: string; statValue: string; amount: string };

const roleThemes: Record<SpacecraftRole, RoleTheme> = {
  fighter:     { topBar: 'bg-rose-500',   badge: 'bg-rose-500/15 border-rose-500/30',   badgeText: 'text-rose-300',   statValue: 'text-rose-200',   amount: 'text-rose-300' },
  miner:       { topBar: 'bg-amber-500',  badge: 'bg-amber-500/15 border-amber-500/30', badgeText: 'text-amber-300',  statValue: 'text-amber-200',  amount: 'text-amber-300' },
  transporter: { topBar: 'bg-sky-500',    badge: 'bg-sky-500/15 border-sky-500/30',     badgeText: 'text-sky-300',    statValue: 'text-sky-200',    amount: 'text-sky-300' },
  salvager:    { topBar: 'bg-violet-500', badge: 'bg-violet-500/15 border-violet-500/30', badgeText: 'text-violet-300', statValue: 'text-violet-200', amount: 'text-violet-300' },
};

function roleTheme(role: SpacecraftRole): RoleTheme {
  return roleThemes[role] ?? roleThemes.fighter;
}

// ── Resource label shorthand ──────────────────────────────────────────────────
const resourceLabels: Record<string, string> = {
  carbon: 'C',
  titanium: 'Ti',
  hydrogenium: 'Hy',
  kyber_crystal: 'KC',
  astatine: 'At',
};
</script>

<template>
  <div class="absolute bottom-0 left-0 w-full z-20 h-[300px] flex flex-col font-mono">
    <!-- Panel background -->
    <div class="absolute inset-0 bg-[#060c1b]/97 backdrop-blur-xl border-t-2 border-cyan-500/40" />
    <!-- Scanlines -->
    <div class="scanlines absolute inset-0 pointer-events-none z-10 opacity-[0.025]" />
    <!-- Corner accents -->
    <div class="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-cyan-400/50 z-10" />
    <div class="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cyan-400/50 z-10" />

    <!-- Content -->
    <div class="relative z-20 flex flex-col h-full">

      <!-- ── Header ─────────────────────────────────────────────────────────── -->
      <div class="flex items-center justify-between px-5 h-11 border-b border-white/[0.07] shrink-0">
        <div class="flex items-center gap-5">
          <div class="flex items-center gap-2.5">
            <span class="text-[9px] text-cyan-400/30 uppercase tracking-[0.4em]">Station</span>
            <span class="text-sm font-semibold tracking-widest text-white">
              {{ stationName ?? 'OMEGA PRIME' }}
            </span>
          </div>
          <div class="hidden md:flex items-center gap-4 text-[10px]">
            <div class="flex items-center gap-1.5">
              <span class="w-1 h-1 rounded-full bg-cyan-400/50" />
              <span class="text-white/25">Mining</span>
              <span class="text-cyan-300 tabular-nums">+342/min</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="w-1 h-1 rounded-full bg-amber-400/70 animate-pulse" />
              <span class="text-white/25">Queue</span>
              <span class="text-amber-300">1 active</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="w-1 h-1 rounded-full bg-green-400/60" />
              <span class="text-white/25">Threat</span>
              <span class="text-green-400 uppercase text-[9px] tracking-widest">LOW</span>
            </div>
          </div>
        </div>
        <button
          @click="emit('close')"
          class="w-7 h-7 flex items-center justify-center rounded text-white/60 hover:text-white/80 hover:bg-white/5 transition text-[11px]"
        >✕</button>
      </div>

      <!-- ── Tab bar ────────────────────────────────────────────────────────── -->
      <div class="flex items-center gap-0.5 px-4 h-8 border-b border-white/5 bg-[#040911]/60 shrink-0">
        <button
          v-for="tab in ['buildings', 'fleet', 'mining', 'defense'] as Section[]"
          :key="tab"
          @click="setSection(tab)"
          class="px-3 h-5 rounded text-[9px] uppercase tracking-[0.25em] transition"
          :class="selectedSection === tab
            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/35'
            : 'text-white/25 hover:text-white/55 hover:bg-white/4'"
        >{{ tab }}</button>
      </div>

      <!-- ── Empty state ────────────────────────────────────────────────────── -->
      <div v-if="!selectedSection" class="flex-1 flex items-center justify-center">
        <div class="text-center">
          <div class="text-xl text-cyan-500/15 mb-2 tracking-[0.6em]">◎</div>
          <p class="text-white/15 text-[9px] uppercase tracking-[0.4em]">Select a command module</p>
        </div>
      </div>

      <!-- ── Buildings ──────────────────────────────────────────────────────── -->
      <div v-if="selectedSection === 'buildings'" class="flex-1 grid grid-cols-[260px_1fr] overflow-hidden">
        <!-- List -->
        <div class="border-r border-white/5 overflow-y-auto">
          <div
            v-for="b in buildings" :key="b.id"
            @click="activeBuilding = b"
            class="flex items-center gap-3 px-4 py-2.5 border-b border-white/4 cursor-pointer transition-colors"
            :class="activeBuilding?.id === b.id ? 'bg-cyan-500/8' : 'hover:bg-white/2.5'"
          >
            <span class="w-1.5 h-1.5 rounded-full shrink-0 mt-0.5"
              :class="b.queued ? 'bg-amber-400 animate-pulse' : 'bg-cyan-500/40'" />
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between">
                <span class="text-[11px] text-white/75">{{ b.name }}</span>
                <span class="text-[10px] text-cyan-400/50 tabular-nums">Lv.{{ b.level }}</span>
              </div>
              <div class="mt-1.5 h-px w-full bg-white/6 rounded-full overflow-hidden">
                <div v-if="b.queued" class="h-full bg-amber-400/60 rounded-full" :style="{ width: `${b.progress}%` }" />
              </div>
            </div>
            <span class="text-[9px] text-white/15 shrink-0">▶</span>
          </div>
        </div>
        <!-- Detail -->
        <div v-if="activeBuilding" class="overflow-y-auto p-4">
          <div class="flex gap-4 h-full">
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline gap-2.5 mb-1">
                <span class="text-[9px] text-cyan-400/35 uppercase tracking-[0.35em]">Module</span>
                <span class="text-[15px] font-semibold tracking-wide text-white">{{ activeBuilding.name }}</span>
                <span class="text-[10px] text-white/25 tabular-nums">Lv.{{ activeBuilding.level }} → {{ activeBuilding.nextLevel }}</span>
              </div>
              <p class="text-[11px] text-white/35 leading-relaxed mb-4">{{ activeBuilding.description }}</p>
              <div class="flex items-center gap-2 flex-wrap mb-3">
                <div v-for="cost in activeBuilding.costs" :key="cost.name"
                  class="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-white/2.5 border border-white/6">
                  <span class="text-[9px] uppercase tracking-widest text-white/25">{{ cost.name }}</span>
                  <span class="text-[11px] text-white/65 tabular-nums">{{ cost.amount }}</span>
                </div>
                <div class="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-white/2.5 border border-white/6">
                  <span class="text-[9px] uppercase tracking-widest text-white/25">Time</span>
                  <span class="text-[11px] text-cyan-300/70 tabular-nums">{{ activeBuilding.buildTime }}</span>
                </div>
              </div>
              <div v-if="activeBuilding.queued">
                <div class="flex items-center justify-between text-[9px] mb-1.5">
                  <span class="text-white/25 uppercase tracking-widest">Upgrading</span>
                  <span class="text-amber-300 tabular-nums">{{ activeBuilding.progress }}%</span>
                </div>
                <div class="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                  <div class="h-full bg-amber-400/65 rounded-full" :style="{ width: `${activeBuilding.progress}%` }" />
                </div>
              </div>
            </div>
            <div class="shrink-0 w-36 flex flex-col gap-2 justify-end pb-1">
              <button class="w-full py-2.5 rounded border text-[10px] uppercase tracking-[0.2em] font-semibold transition"
                :class="activeBuilding.queued
                  ? 'border-amber-500/25 bg-amber-500/8 text-amber-400/50 cursor-not-allowed'
                  : 'border-cyan-500/40 bg-cyan-500/9 hover:bg-cyan-500/20 text-cyan-200'">
                {{ activeBuilding.queued ? 'Upgrading…' : 'Upgrade' }}
              </button>
              <button class="w-full py-2 rounded border border-white/5 bg-white/2 hover:bg-white/4 text-[9px] uppercase tracking-widest text-white/25 transition">
                Details
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Fleet ──────────────────────────────────────────────────────────── -->
      <div v-if="selectedSection === 'fleet'" class="flex-1 overflow-hidden flex flex-col">
        <!-- Loading -->
        <div v-if="fleetLoading" class="flex-1 flex items-center justify-center">
          <div class="flex items-center gap-2 text-cyan-400/50 text-[10px] uppercase tracking-widest">
            <span class="inline-block w-3 h-3 border border-cyan-400/50 border-t-cyan-400 rounded-full animate-spin" />
            Loading fleet…
          </div>
        </div>
        <!-- Error -->
        <div v-else-if="fleetError" class="flex-1 flex items-center justify-center">
          <p class="text-rose-400/60 text-[10px] uppercase tracking-widest">{{ fleetError }}</p>
        </div>
        <!-- Empty -->
        <div v-else-if="fleet.length === 0" class="flex-1 flex items-center justify-center">
          <p class="text-white/15 text-[9px] uppercase tracking-[0.4em]">No spacecraft assigned</p>
        </div>
        <!-- Cards -->
        <div v-else class="flex-1 overflow-x-auto overflow-y-hidden px-4 py-3">
          <div class="flex gap-3 h-full">
            <div
              v-for="entry in fleet"
              :key="entry.definition.id"
              class="shrink-0 w-[168px] h-full flex flex-col rounded border border-white/8 bg-[#080f22]/80 overflow-hidden relative group hover:border-white/20 transition-colors"
            >
              <!-- Role color top bar -->
              <div class="h-[3px] w-full shrink-0" :class="roleTheme(entry.definition.role).topBar" />

              <!-- Ship image + name row -->
              <div class="flex items-center gap-2.5 px-3 pt-2.5 pb-1.5 shrink-0">
                <div class="w-10 h-10 shrink-0 rounded bg-white/4 border border-white/7 flex items-center justify-center overflow-hidden">
                  <img
                    :src="entry.definition.image ?? ''"
                    :alt="entry.definition.name"
                    class="w-full h-full object-contain opacity-70 group-hover:opacity-90 transition-opacity"
                    @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
                  />
                  <!-- Fallback icon if image missing -->
                  <span class="text-white/15 text-[16px] absolute">◈</span>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-[12px] font-semibold text-white/85 leading-tight truncate">
                    {{ entry.definition.name }}
                  </div>
                  <span
                    class="inline-block mt-0.5 px-1.5 py-px rounded text-[8px] uppercase tracking-widest border"
                    :class="roleTheme(entry.definition.role).badge"
                  >
                    <span :class="roleTheme(entry.definition.role).badgeText">
                      {{ entry.definition.role }}
                    </span>
                  </span>
                </div>
              </div>

              <!-- Divider -->
              <div class="mx-3 h-px bg-white/5 shrink-0" />

              <!-- Stats grid -->
              <div class="grid grid-cols-2 gap-x-2 gap-y-1 px-3 py-2 shrink-0">
                <div v-for="stat in [
                  { label: 'ATK', value: entry.definition.attack },
                  { label: 'DEF', value: entry.definition.defense },
                  { label: 'SPD', value: entry.definition.speed },
                  { label: 'CRG', value: entry.definition.cargo },
                  ...(entry.definition.miningRate > 0
                    ? [{ label: 'MINE', value: entry.definition.miningRate }]
                    : []),
                ]" :key="stat.label"
                  class="flex items-center justify-between"
                >
                  <span class="text-[8px] text-white/25 uppercase tracking-wider">{{ stat.label }}</span>
                  <span class="text-[10px] tabular-nums font-medium" :class="roleTheme(entry.definition.role).statValue">
                    {{ stat.value }}
                  </span>
                </div>
              </div>

              <!-- Divider -->
              <div class="mx-3 h-px bg-white/5 shrink-0" />

              <!-- Build time -->
              <div class="flex items-center justify-between px-3 py-1.5 shrink-0">
                <span class="text-[8px] text-white/20 uppercase tracking-wider">Build</span>
                <span class="text-[9px] text-cyan-400/60 tabular-nums">{{ entry.definition.buildTime }}s</span>
              </div>

              <!-- Costs -->
              <div class="flex flex-wrap gap-1 px-3 pb-2 shrink-0">
                <div
                  v-for="cost in entry.definition.costs"
                  :key="cost.resourceKey"
                  class="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white/3 border border-white/6"
                >
                  <span class="text-[8px] text-white/30">{{ resourceLabels[cost.resourceKey] ?? cost.resourceKey }}</span>
                  <span class="text-[8px] text-white/50 tabular-nums">{{ cost.amount }}</span>
                </div>
              </div>

              <!-- Amount badge (bottom-right) -->
              <div class="mt-auto px-3 pb-2.5 flex items-center justify-between">
                <span class="text-[8px] text-white/15 uppercase tracking-wider">In fleet</span>
                <span class="text-[18px] font-bold tabular-nums leading-none" :class="roleTheme(entry.definition.role).amount">
                  {{ entry.amount.toLocaleString() }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Placeholder tabs ───────────────────────────────────────────────── -->
      <div
        v-for="section in ['mining', 'defense'] as Section[]"
        v-show="selectedSection === section"
        :key="section"
        class="flex-1 flex items-center justify-center"
      >
        <p class="text-white/15 text-[9px] uppercase tracking-[0.4em]">{{ section }} — coming soon</p>
      </div>

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
