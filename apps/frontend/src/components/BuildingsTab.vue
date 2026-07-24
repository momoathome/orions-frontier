<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { wsClient } from '../lib/ws-client';
import { apiClient, apiErrorMessage } from '../lib/api-client';
import type { StationBuildingWithDefinition, BuildingEffectType } from '@orions-frontier/shared';

const props = defineProps<{ stationId: string }>();
const emit = defineEmits<{ queueCount: [count: number] }>();

const buildings = ref<StationBuildingWithDefinition[]>([]);
const activeBuilding = ref<StationBuildingWithDefinition | null>(null);
const buildingsLoading = ref(false);
const buildingsError = ref<string | null>(null);
const upgrading = ref<string | null>(null);

// Track first-detected timestamp per building key to drive the progress bar
const upgradeDetectedAt = new Map<string, number>();

// Reactive clock – ticks every second for timer countdown & progress bar
const now = ref(Date.now());
const nowInterval = setInterval(() => {
  now.value = Date.now();
}, 1000);
onUnmounted(() => clearInterval(nowInterval));

type EffectTheme = { topBar: string; badge: string; badgeText: string; level: string };

const effectThemes: Record<BuildingEffectType, EffectTheme> = {
  station_progression: {
    topBar: 'bg-cyan-500',
    badge: 'bg-cyan-500/15 border-cyan-500/30',
    badgeText: 'text-cyan-300',
    level: 'text-cyan-300',
  },
  hangar_capacity: {
    topBar: 'bg-cyan-400',
    badge: 'bg-cyan-400/15 border-cyan-400/30',
    badgeText: 'text-cyan-200',
    level: 'text-cyan-200',
  },
  spacecraft_unlock: {
    topBar: 'bg-violet-500',
    badge: 'bg-violet-500/15 border-violet-500/30',
    badgeText: 'text-violet-300',
    level: 'text-violet-300',
  },
  spacecraft_production_bonus: {
    topBar: 'bg-violet-400',
    badge: 'bg-violet-400/15 border-violet-400/30',
    badgeText: 'text-violet-200',
    level: 'text-violet-200',
  },
  storage_capacity: {
    topBar: 'bg-amber-500',
    badge: 'bg-amber-500/15 border-amber-500/30',
    badgeText: 'text-amber-300',
    level: 'text-amber-300',
  },
  protected_storage: {
    topBar: 'bg-amber-400',
    badge: 'bg-amber-400/15 border-amber-400/30',
    badgeText: 'text-amber-200',
    level: 'text-amber-200',
  },
  scanner_range: {
    topBar: 'bg-sky-500',
    badge: 'bg-sky-500/15 border-sky-500/30',
    badgeText: 'text-sky-300',
    level: 'text-sky-300',
  },
  research_capacity: {
    topBar: 'bg-green-500',
    badge: 'bg-green-500/15 border-green-500/30',
    badgeText: 'text-green-300',
    level: 'text-green-300',
  },
};

function buildingTheme(effectType: BuildingEffectType): EffectTheme {
  return effectThemes[effectType];
}

const effectTypeLabels: Record<BuildingEffectType, string> = {
  station_progression: 'Progression',
  hangar_capacity: 'Hangar',
  spacecraft_unlock: 'Shipyard',
  spacecraft_production_bonus: 'Production',
  storage_capacity: 'Storage',
  protected_storage: 'Protection',
  scanner_range: 'Scanner',
  research_capacity: 'Research',
};

function formatEffect(type: string, value: number): { label: string; display: string } {
  switch (type as BuildingEffectType) {
    case 'station_progression':
      return { label: 'Station Score', display: `+${value}` };
    case 'hangar_capacity':
      return { label: 'Crew places', display: `${value}` };
    case 'spacecraft_unlock':
      return { label: 'Ship Tier', display: `Tier ${value}` };
    case 'spacecraft_production_bonus':
      return { label: 'Build Speed', display: `+${value}%` };
    case 'storage_capacity':
      return { label: 'Capacity', display: value.toLocaleString() };
    case 'protected_storage':
      return { label: 'Protected', display: value.toLocaleString() };
    case 'scanner_range':
      return { label: 'Scan Range', display: `${value.toLocaleString()} units` };
    case 'research_capacity':
      return { label: 'Research capacity', display: `${value}` };
    default:
      return { label: type.replace(/_/g, ' '), display: `${value}` };
  }
}

function upgradeTimeRemaining(building: StationBuildingWithDefinition): string | null {
  if (!building.upgradeEndsAt) return null;
  const ms = new Date(building.upgradeEndsAt).getTime() - now.value;
  if (ms <= 0) return null;
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function upgradeProgress(building: StationBuildingWithDefinition): number {
  if (!building.upgradeEndsAt) return 0;
  const detectedAt = upgradeDetectedAt.get(building.definition.key) ?? now.value;
  const endsAt = new Date(building.upgradeEndsAt).getTime();
  const total = endsAt - detectedAt;
  if (total <= 0) return 100;
  const elapsed = now.value - detectedAt;
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

// Merged current + next effect rows for the detail panel
const zippedEffects = computed(() => {
  if (!activeBuilding.value) return [];
  return activeBuilding.value.effects.map((cur) => {
    const next = activeBuilding.value!.nextLevelEffects?.find((n) => n.type === cur.type) ?? null;
    return { type: cur.type, current: cur.value, next: next?.value ?? null };
  });
});

async function loadBuildings(force = false) {
  if (buildings.value.length > 0 && !force) return;
  buildingsLoading.value = true;
  buildingsError.value = null;
  try {
    const response = await apiClient.get(`/stations/${props.stationId}/buildings`);
    buildings.value = response.buildings;
    // Record detection time for any upgrading building we haven't seen yet
    for (const b of buildings.value) {
      if (b.isUpgrading && !upgradeDetectedAt.has(b.definition.key)) {
        upgradeDetectedAt.set(b.definition.key, Date.now());
      }
    }
    if (!activeBuilding.value && buildings.value.length > 0) {
      activeBuilding.value = buildings.value[0]!;
    } else if (activeBuilding.value) {
      const refreshed = buildings.value.find(
        (b) => b.definition.key === activeBuilding.value!.definition.key
      );
      if (refreshed) activeBuilding.value = refreshed;
    }
  } catch {
    buildingsError.value = 'Failed to load buildings';
  } finally {
    buildingsLoading.value = false;
  }
  emit('queueCount', buildings.value.filter((b) => b.isUpgrading).length);
}

async function startUpgrade(building: StationBuildingWithDefinition) {
  if (upgrading.value || building.isUpgrading) return;
  upgrading.value = building.definition.key;
  try {
    await apiClient.post(
      `/stations/${props.stationId}/buildings/${building.definition.key}/upgrade`
    );
    await loadBuildings(true);
  } catch (error) {
    buildingsError.value = apiErrorMessage(error, 'Upgrade failed');
    setTimeout(() => {
      buildingsError.value = null;
    }, 4000);
  } finally {
    upgrading.value = null;
  }
}

loadBuildings();

const unsubscribe = wsClient.on('building_upgrade_completed', (payload) => {
  const p = payload as { stationId?: string; buildingKey?: string };
  if (p?.stationId === props.stationId) {
    if (p.buildingKey) upgradeDetectedAt.delete(p.buildingKey);
    loadBuildings(true);
  }
});

onUnmounted(() => unsubscribe());
</script>

<template>
  <!-- Loading -->
  <div v-if="buildingsLoading" class="flex-1 flex items-center justify-center">
    <div class="flex items-center gap-2 text-cyan-400/50 text-[10px] uppercase tracking-widest">
      <span
        class="inline-block w-3 h-3 border border-cyan-400/50 border-t-cyan-400 rounded-full animate-spin"
      />
      Loading buildings…
    </div>
  </div>

  <!-- Error -->
  <div
    v-else-if="buildingsError && buildings.length === 0"
    class="flex-1 flex items-center justify-center"
  >
    <p class="text-rose-400/60 text-[10px] uppercase tracking-widest">{{ buildingsError }}</p>
  </div>

  <!-- Empty -->
  <div v-else-if="buildings.length === 0" class="flex-1 flex items-center justify-center">
    <p class="text-white/15 text-[9px] uppercase tracking-[0.4em]">No buildings found</p>
  </div>

  <!-- Content -->
  <div v-else class="flex-1 grid grid-cols-[280px_1fr] overflow-hidden">
    <!-- Icon grid -->
    <div class="border-r border-white/5 overflow-y-auto p-3">
      <div class="grid grid-cols-3 gap-1.5">
        <div
          v-for="b in buildings"
          :key="b.definition.key"
          @click="activeBuilding = b"
          class="flex flex-col items-center gap-1 pt-1.5 pb-2 px-1 rounded cursor-pointer border transition-all"
          :class="
            activeBuilding?.definition.key === b.definition.key
              ? 'bg-white/8 border-white/20'
              : 'border-white/5 hover:bg-white/4 hover:border-white/12'
          "
        >
          <div
            class="w-full h-0.5 rounded-full"
            :class="buildingTheme(b.definition.effectType).topBar"
          />
          <div class="w-9 h-9 relative flex items-center justify-center mt-1">
            <span class="text-white/10 text-[20px] absolute select-none pointer-events-none"
              >◈</span
            >
            <img
              v-if="b.definition.image"
              :src="b.definition.image"
              :alt="b.definition.name"
              class="w-full h-full object-contain opacity-65 relative z-10"
              @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
            />
          </div>
          <span class="text-[8px] text-white/40 text-center leading-tight w-full truncate px-0.5">
            {{ b.definition.name }}
          </span>
          <span
            class="text-[11px] font-semibold tabular-nums leading-none"
            :class="
              b.isUpgrading
                ? 'text-amber-400 animate-pulse'
                : buildingTheme(b.definition.effectType).level
            "
          >
            Lv.{{ b.level }}
          </span>
        </div>
      </div>
    </div>

    <!-- Detail -->
    <div v-if="activeBuilding" class="overflow-y-auto p-4 flex gap-4">
      <div class="flex-1 min-w-0 flex flex-col gap-4">
        <!-- Header -->
        <div class="flex items-center gap-2.5">
          <span class="text-[15px] font-semibold text-white tracking-wide">
            {{ activeBuilding.definition.name }}
          </span>
          <span
            class="px-1.5 py-px rounded text-[8px] uppercase tracking-widest border"
            :class="buildingTheme(activeBuilding.definition.effectType).badge"
          >
            <span :class="buildingTheme(activeBuilding.definition.effectType).badgeText">
              {{ effectTypeLabels[activeBuilding.definition.effectType] }}
            </span>
          </span>
          <span class="ml-auto text-[9px] text-white/25">
            Level
            <span
              class="font-semibold tabular-nums"
              :class="
                activeBuilding.isUpgrading
                  ? 'text-amber-400'
                  : buildingTheme(activeBuilding.definition.effectType).level
              "
            >
              {{ activeBuilding.level }}
            </span>
            <span
              v-if="activeBuilding.level < activeBuilding.definition.maxLevel"
              class="text-white/20"
            >
              / {{ activeBuilding.definition.maxLevel }}
            </span>
            <span v-else class="text-amber-400/60 ml-1 uppercase tracking-widest text-[8px]"
              >MAX</span
            >
          </span>
        </div>

        <!-- Description -->
        <p class="text-[11px] text-white/35 leading-relaxed -mt-2">
          {{ activeBuilding.definition.description }}
        </p>

        <!-- Effects + Costs: side by side, like SpacecraftStats -->
        <div class="flex gap-12">
          <!-- Effects column -->
          <div class="flex flex-col gap-1 shrink-0">
            <span class="text-[9px] text-white/20 uppercase tracking-widest mb-0.5">Effects</span>
            <div class="flex flex-col gap-0.5">
              <div v-for="row in zippedEffects" :key="row.type" class="flex items-center gap-2 h-5">
                <span class="text-[9px] text-white/25 w-24 shrink-0">
                  {{ formatEffect(row.type, row.current).label }}
                </span>
                <span class="text-[11px] text-cyan-300/80 tabular-nums font-medium">
                  {{ formatEffect(row.type, row.current).display }}
                </span>
                <template v-if="row.next !== null">
                  <span class="text-white/20 text-[9px] shrink-0">→</span>
                  <span class="text-[11px] text-green-300/80 tabular-nums font-medium">
                    {{ formatEffect(row.type, row.next).display }}
                  </span>
                </template>
              </div>
            </div>
          </div>

          <!-- Costs column -->
          <div v-if="activeBuilding.upgradeCosts.length > 0" class="flex flex-col gap-1">
            <span class="text-[9px] text-white/20 uppercase tracking-widest mb-0.5">Cost</span>
            <div class="grid grid-cols-2 gap-x-4 gap-y-0.5">
              <div
                v-for="cost in activeBuilding.upgradeCosts"
                :key="cost.resourceKey"
                class="flex items-center gap-1.5 h-5"
              >
                <img
                  :src="`/assets/resources/${cost.resourceKey}.png`"
                  :alt="cost.resourceKey"
                  class="w-3.5 h-3.5 object-contain opacity-80 shrink-0"
                />
                <span class="text-[10px] text-white/65 tabular-nums">
                  {{ cost.amount.toLocaleString() }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Unlock milestones -->
        <div v-if="Object.keys(activeBuilding.unlockMilestones).length > 0">
          <span class="text-[9px] text-white/20 uppercase tracking-widest block mb-1.5">
            Unlocks
          </span>
          <div class="flex flex-wrap gap-1.5">
            <div
              v-for="(keys, lvl) in activeBuilding.unlockMilestones"
              :key="lvl"
              class="flex items-center gap-1.5 px-2 py-1 rounded border"
              :class="
                activeBuilding.level >= Number(lvl)
                  ? 'bg-green-500/8 border-green-500/20'
                  : 'bg-white/2.5 border-white/6'
              "
            >
              <span class="text-[9px] text-white/25">Lv.{{ lvl }}</span>
              <span
                class="text-[9px]"
                :class="activeBuilding.level >= Number(lvl) ? 'text-green-300/70' : 'text-white/40'"
              >
                {{ (keys as string[]).join(', ') }}
              </span>
            </div>
          </div>
        </div>

        <!-- Upgrade timer -->
        <div v-if="activeBuilding.isUpgrading" :key="activeBuilding.definition.key">
          <div class="flex items-center justify-between text-[9px] mb-1.5">
            <span class="text-white/25 uppercase tracking-widest">Upgrading</span>
            <span class="text-amber-300 tabular-nums">
              {{ upgradeTimeRemaining(activeBuilding) ?? '…' }}
            </span>
          </div>
          <div class="h-1 w-full bg-white/5 rounded-full overflow-hidden">
            <div
              class="h-full bg-amber-400/65 rounded-full transition-[width] duration-1000 ease-linear"
              :style="{ width: `${upgradeProgress(activeBuilding)}%` }"
            />
          </div>
        </div>

        <p v-if="buildingsError" class="text-rose-400/70 text-[10px]">{{ buildingsError }}</p>
      </div>

      <!-- Action button -->
      <div class="shrink-0 w-36 flex flex-col justify-end pb-1">
        <button
          @click="startUpgrade(activeBuilding)"
          :disabled="
            activeBuilding.isUpgrading ||
            activeBuilding.level >= activeBuilding.definition.maxLevel ||
            !!upgrading
          "
          class="w-full py-2.5 rounded border text-[10px] uppercase tracking-[0.2em] font-semibold transition"
          :class="
            activeBuilding.isUpgrading ||
            activeBuilding.level >= activeBuilding.definition.maxLevel ||
            !!upgrading
              ? 'border-amber-500/25 bg-amber-500/8 text-amber-400/50 cursor-not-allowed'
              : 'border-cyan-500/40 bg-cyan-500/9 hover:bg-cyan-500/20 text-cyan-200'
          "
        >
          <span v-if="activeBuilding.level >= activeBuilding.definition.maxLevel">Max Level</span>
          <span v-else-if="activeBuilding.isUpgrading">Upgrading…</span>
          <span v-else-if="upgrading === activeBuilding.definition.key">Starting…</span>
          <span v-else>Upgrade</span>
        </button>
      </div>
    </div>

    <div v-else class="flex items-center justify-center">
      <p class="text-white/15 text-[9px] uppercase tracking-[0.4em]">Select a building</p>
    </div>
  </div>
</template>
