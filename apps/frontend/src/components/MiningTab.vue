<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { apiClient } from '../lib/api-client';
import { wsClient } from '../lib/ws-client';
import type { AsteroidDetail } from '@orions-frontier/shared';
import {
  resourceColor,
  resourceName,
  stabilityColor,
  SIZE_LABELS,
  calcEffectiveRateByResource,
  calcTotalEffectiveRate,
  calcStabilityChangePerHour,
} from '../lib/mining-utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface StationMiningAssignment {
  id: string;
  asteroidId: string;
  asteroidX: number;
  asteroidY: number;
  asteroidSize: string;
  asteroidStability: number;
  asteroidPrimaryResourceKey: string | null;
  spacecraftDefinitionId: string;
  spacecraftName: string;
  spacecraftMiningRate: number;
  assignedAmount: number;
  assignedAt: string;
  lastTick: string;
}

interface AsteroidGroup {
  asteroidId: string;
  asteroidX: number;
  asteroidY: number;
  asteroidSize: string;
  asteroidStability: number;
  asteroidPrimaryResourceKey: string | null;
  assignments: StationMiningAssignment[];
  totalShips: number;
}

// ── Props & Emits ────────────────────────────────────────────────────────────

const props = defineProps<{ stationId: string }>();
const emit = defineEmits<{
  queueCount: [count: number];
  totalMiningRate: [rate: number];
}>();

// ── State ────────────────────────────────────────────────────────────────────

const assignments = ref<StationMiningAssignment[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const activeAsteroidId = ref<string | null>(null);
/** All fetched asteroid details keyed by asteroidId */
const allDetails = ref<Record<string, AsteroidDetail>>({});
/** The currently selected asteroid's detail — null while loading */
const activeDetail = computed<AsteroidDetail | null>(() =>
  activeAsteroidId.value ? (allDetails.value[activeAsteroidId.value] ?? null) : null,
);
/** True while the selected asteroid's detail has not yet arrived */
const detailLoading = computed(() =>
  activeAsteroidId.value != null && !(activeAsteroidId.value in allDetails.value),
);

// ── Grouping ─────────────────────────────────────────────────────────────────

const asteroidGroups = computed<AsteroidGroup[]>(() => {
  const map = new Map<string, AsteroidGroup>();
  for (const a of assignments.value) {
    if (!map.has(a.asteroidId)) {
      map.set(a.asteroidId, {
        asteroidId: a.asteroidId,
        asteroidX: a.asteroidX,
        asteroidY: a.asteroidY,
        asteroidSize: a.asteroidSize,
        asteroidStability: a.asteroidStability,
        asteroidPrimaryResourceKey: a.asteroidPrimaryResourceKey,
        assignments: [],
        totalShips: 0,
      });
    }
    const g = map.get(a.asteroidId)!;
    g.assignments.push(a);
    g.totalShips += a.assignedAmount;
  }
  return [...map.values()];
});

// ── Display helpers ───────────────────────────────────────────────────────────



// ── Rate calculations ─────────────────────────────────────────────────────────

/** Effective total mining rate (units/h) for an asteroid given its detail and assignments. */
function computeEffectiveRate(detail: AsteroidDetail, groupAssignments: StationMiningAssignment[]): number {
  const miningPower = groupAssignments.reduce(
    (sum, a) => sum + a.assignedAmount * a.spacecraftMiningRate,
    0,
  );
  return calcTotalEffectiveRate(miningPower, detail.veins);
}

const totalMiningPowerRaw = computed(() =>
  activeDetail.value?.assignments.reduce(
    (sum, a) => sum + a.assignedAmount * a.spacecraftMiningRate,
    0,
  ) ?? 0,
);

const effectiveRateByResource = computed(() =>
  calcEffectiveRateByResource(totalMiningPowerRaw.value, activeDetail.value?.veins ?? []),
);

const sortedEffectiveRates = computed(() =>
  Object.entries(effectiveRateByResource.value).sort((a, b) => b[1] - a[1]),
);

const stabilityChangePerHour = computed(() =>
  calcStabilityChangePerHour(
    totalMiningPowerRaw.value,
    activeDetail.value?.veins ?? [],
    (activeDetail.value?.assignments.length ?? 0) > 0,
  ),
);

// ── Grouped ships in detail panel ─────────────────────────────────────────────

const activeGroupedShips = computed(() => {
  const group = asteroidGroups.value.find((g) => g.asteroidId === activeAsteroidId.value);
  if (!group) return [];
  const map = new Map<string, { name: string; amount: number; miningRate: number }>();
  for (const a of group.assignments) {
    if (!map.has(a.spacecraftDefinitionId)) {
      map.set(a.spacecraftDefinitionId, {
        name: a.spacecraftName,
        amount: 0,
        miningRate: a.spacecraftMiningRate,
      });
    }
    map.get(a.spacecraftDefinitionId)!.amount += a.assignedAmount;
  }
  return [...map.values()];
});

// ── Total mining rate emitted to parent (HUD) ─────────────────────────────────

const globalTotalRatePerHour = computed(() => {
  let total = 0;
  for (const group of asteroidGroups.value) {
    const detail = allDetails.value[group.asteroidId];
    if (detail) total += computeEffectiveRate(detail, group.assignments);
  }
  return total;
});

watch(globalTotalRatePerHour, (rate) => emit('totalMiningRate', rate), { immediate: true });
emit('queueCount', 0);

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadAssignments(force = false) {
  if (assignments.value.length > 0 && !force) return;
  if (!force) loading.value = true;
  error.value = null;
  try {
    const { data } = await apiClient.get(`/stations/${props.stationId}/mining-assignments`);
    assignments.value = data.data.assignments;
    // Auto-select first asteroid
    if (!activeAsteroidId.value && asteroidGroups.value.length > 0) {
      activeAsteroidId.value = asteroidGroups.value[0]!.asteroidId;
    }
    // Prefetch details for all asteroids (background — no spinner)
    const ids = [...new Set(assignments.value.map((a) => a.asteroidId))];
    await Promise.all(ids.map((id) => loadDetail(id)));
  } catch {
    error.value = 'Failed to load mining assignments';
  } finally {
    loading.value = false;
  }
}

async function loadDetail(asteroidId: string) {
  try {
    const { data } = await apiClient.get(`/asteroids/${asteroidId}`, {
      params: { scannerStrength: 100 },
    });
    allDetails.value = { ...allDetails.value, [asteroidId]: data.data.asteroid };
  } catch {
    // silently ignore per-asteroid failures
  }
}

function selectAsteroid(id: string) {
  activeAsteroidId.value = id;
  // Only fetch if not already cached
  if (!(id in allDetails.value)) {
    loadDetail(id);
  }
}

loadAssignments();

const unsubscribe = wsClient.on('mining_tick_completed', () => {
  // Reload assignments and all details on each mining tick
  allDetails.value = {};
  loadAssignments(true);
});

onUnmounted(() => unsubscribe());
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
  <!-- Loading -->
  <div v-if="loading" class="flex-1 flex items-center justify-center">
    <div class="flex items-center gap-2 text-cyan-400/50 text-[10px] uppercase tracking-widest">
      <span class="inline-block w-3 h-3 border border-cyan-400/50 border-t-cyan-400 rounded-full animate-spin" />
      Loading…
    </div>
  </div>

  <!-- Error -->
  <div v-else-if="error" class="flex-1 flex items-center justify-center">
    <p class="text-rose-400/60 text-[10px] uppercase tracking-widest">{{ error }}</p>
  </div>

  <!-- Empty -->
  <div v-else-if="asteroidGroups.length === 0" class="flex-1 flex items-center justify-center">
    <p class="text-white/15 text-[9px] uppercase tracking-[0.4em]">No active mining operations</p>
  </div>

  <!-- Content -->
  <div v-else class="flex-1 min-h-0 overflow-hidden flex">
    <!-- ── Left: Asteroid card list ───────────────────────────────────────── -->
    <div class="w-56 shrink-0 border-r border-white/5 overflow-y-auto p-2 min-h-0">
      <div class="grid grid-cols-2 gap-1.5">
      <div
        v-for="group in asteroidGroups"
        :key="group.asteroidId"
        @click="selectAsteroid(group.asteroidId)"
        class="rounded border cursor-pointer transition-all p-2 flex flex-col gap-1.5"
        :class="
          activeAsteroidId === group.asteroidId
            ? 'bg-white/8 border-white/20'
            : 'border-white/5 hover:bg-white/4 hover:border-white/12'
        "
      >
        <!-- Top accent bar using primary resource color -->
        <div
          class="w-full h-0.5 rounded-full"
          :style="{ backgroundColor: resourceColor(group.asteroidPrimaryResourceKey) + '99' }"
        />

        <!-- Size badge + resource dot -->
        <div class="flex items-center justify-between">
          <span
            class="text-[10px] font-bold tabular-nums"
            :style="{ color: resourceColor(group.asteroidPrimaryResourceKey) }"
          >
            {{ SIZE_LABELS[group.asteroidSize] ?? group.asteroidSize.toUpperCase() }}
          </span>
          <span
            class="w-1.5 h-1.5 rounded-full"
            :style="{ backgroundColor: resourceColor(group.asteroidPrimaryResourceKey) }"
          />
        </div>

        <!-- Coords -->
        <p class="text-[8px] text-white/25 tabular-nums leading-none">
          {{ group.asteroidX.toFixed(0) }}, {{ group.asteroidY.toFixed(0) }}
        </p>

        <!-- Stability bar -->
        <div class="w-full h-0.5 bg-white/10 rounded-full overflow-hidden">
          <div
            class="h-full rounded-full transition-all"
            :style="{
              width: (group.asteroidStability * 100).toFixed(0) + '%',
              backgroundColor: stabilityColor(group.asteroidStability),
            }"
          />
        </div>

        <!-- Ships count -->
        <div class="flex items-center justify-between">
          <span class="text-[8px] text-white/25 uppercase tracking-wider">Ships</span>
          <span class="text-[9px] font-semibold text-white/60 tabular-nums">×{{ group.totalShips }}</span>
        </div>

        <!-- Effective rate (shown once detail is loaded) -->
        <div
          v-if="allDetails[group.asteroidId]"
          class="text-[8px] tabular-nums font-semibold text-right leading-none"
          :style="{ color: resourceColor(group.asteroidPrimaryResourceKey) + 'cc' }"
        >
          +{{ Math.round(computeEffectiveRate(allDetails[group.asteroidId]!, group.assignments)) }}/h
        </div>
        <div v-else class="h-3" />
      </div>
      </div>
    </div>

    <!-- ── Right: Detail panel ────────────────────────────────────────────── -->
    <div class="flex-1 min-h-0 overflow-hidden">
      <!-- Detail loading -->
      <div v-if="detailLoading" class="h-full flex items-center justify-center">
        <span class="inline-block w-3 h-3 border border-cyan-400/50 border-t-cyan-400 rounded-full animate-spin" />
      </div>

      <div v-else-if="activeDetail" class="h-full overflow-y-auto p-4">
        <div class="flex gap-5">

          <!-- ── Col 1: Assigned Ships ──────────────────────────────────────── -->
          <div class="w-56 shrink-0 flex flex-col gap-2">
            <p class="text-[8px] text-white/25 uppercase tracking-[0.3em]">Assigned Ships</p>
            <div class="flex flex-col gap-1">
              <div
                v-for="ship in activeGroupedShips"
                :key="ship.name"
                class="flex items-center gap-2 px-2 py-1.5 rounded bg-white/4 border border-white/5"
              >
                <div class="w-5 h-5 rounded bg-white/8 flex items-center justify-center shrink-0">
                  <span class="text-[8px] text-white/40">◈</span>
                </div>
                <span class="text-[10px] text-white/70 flex-1 truncate">{{ ship.name }}</span>
                <span class="text-[9px] text-cyan-300 tabular-nums shrink-0">×{{ ship.amount }}</span>
              </div>
            </div>
          </div>

          <!-- ── Col 2: Resources + Stability + Buffer ─────────────────── -->
          <div class="w-44 shrink-0 flex flex-col gap-4">

            <!-- Resources -->
            <div v-if="sortedEffectiveRates.length > 0" class="flex flex-col gap-2">
              <p class="text-[8px] text-white/25 uppercase tracking-[0.3em]">Resources</p>
              <div class="flex flex-col gap-0.5">
                <div
                  v-for="[key, rate] in sortedEffectiveRates"
                  :key="key"
                  class="flex items-center gap-2 py-1"
                >
                  <span
                    class="w-1.5 h-1.5 rounded-full shrink-0"
                    :style="{ backgroundColor: resourceColor(key) }"
                  />
                  <span class="text-[10px] text-white/50 flex-1">{{ resourceName(key) }}</span>
                  <span class="text-[10px] tabular-nums font-semibold" :style="{ color: resourceColor(key) }">
                    +{{ Math.round(rate) }}/h
                  </span>
                </div>
              </div>
            </div>

            <!-- Buffer -->
            <div v-if="activeDetail.storage.length > 0" class="flex flex-col gap-2">
              <p class="text-[8px] text-white/25 uppercase tracking-[0.3em]">Buffer</p>
              <div class="flex flex-col gap-0.5">
                <div
                  v-for="s in activeDetail.storage.filter(s => s.amount > 0)"
                  :key="s.resourceKey"
                  class="flex items-center gap-2 py-1"
                >
                  <span
                    class="w-1.5 h-1.5 rounded-full shrink-0 opacity-50"
                    :style="{ backgroundColor: resourceColor(s.resourceKey) }"
                  />
                  <span class="text-[10px] text-white/40 flex-1">{{ resourceName(s.resourceKey) }}</span>
                  <span class="text-[10px] tabular-nums text-white/35">
                    {{ Math.round(s.amount).toLocaleString() }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Stability -->
            <div class="flex flex-col gap-2">
              <p class="text-[8px] text-white/25 uppercase tracking-[0.3em]">Stability</p>
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center gap-2">
                  <div class="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all"
                      :style="{
                        width: (activeDetail.stability * 100).toFixed(0) + '%',
                        backgroundColor: stabilityColor(activeDetail.stability),
                      }"
                    />
                  </div>
                  <span
                    class="text-[10px] tabular-nums font-semibold shrink-0"
                    :style="{ color: stabilityColor(activeDetail.stability) }"
                  >
                    {{ (activeDetail.stability * 100).toFixed(0) }}%
                  </span>
                </div>
                <span
                  v-if="stabilityChangePerHour !== null"
                  class="text-[8px] uppercase tracking-wider"
                  :class="stabilityChangePerHour >= 0 ? 'text-green-400/60' : 'text-rose-400/60'"
                >
                  {{ stabilityChangePerHour >= 0 ? '↑ regenerating' : '↓ degrading' }}
                </span>
              </div>
            </div>

          </div>
        </div>
      </div>

      <div v-else class="h-full flex items-center justify-center">
        <p class="text-white/15 text-[9px] uppercase tracking-[0.4em]">Select an asteroid</p>
      </div>
    </div>
  </div>
  </div>
</template>
