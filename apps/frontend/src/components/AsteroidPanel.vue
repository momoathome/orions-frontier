<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { apiClient } from '../lib/api-client';
import type { AsteroidDetail, AsteroidVein } from '@orions-frontier/shared';
import type { StationSpacecraftWithDefinition } from '@orions-frontier/shared';
import AsteroidVeinList from './AsteroidVeinList.vue';
import AssignMinerModal from './AssignMinerModal.vue';
import RecallMinerModal, { type AssignmentGroup } from './RecallMinerModal.vue';

const props = defineProps<{
  asteroidId: string;
  stationId: string | null;
}>();

const emit = defineEmits<{ close: []; refresh: [] }>();

// ── Data fetch ───────────────────────────────────────────────────────────────

const asteroid = ref<AsteroidDetail | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function loadAsteroid(id: string) {
  loading.value = true;
  error.value = null;
  asteroid.value = null;
  try {
    const { data } = await apiClient.get(`/asteroids/${id}`, {
      params: { scannerStrength: 100 },
    });
    asteroid.value = data.data.asteroid;
  } catch (err: any) {
    if (err?.response?.status === 404) { emit('close'); return; }
    error.value = 'Unable to retrieve asteroid data.';
  } finally {
    loading.value = false;
  }
}

watch(() => props.asteroidId, (id) => loadAsteroid(id), { immediate: true });

// ── Assign Modal ─────────────────────────────────────────────────────────────

const showAssignModal = ref(false);
const miners = ref<StationSpacecraftWithDefinition[]>([]);

async function openAssignModal() {
  if (props.stationId && miners.value.length === 0) {
    const { data } = await apiClient.get(`/stations/${props.stationId}/spacecrafts`);
    miners.value = (data.data.spacecrafts as StationSpacecraftWithDefinition[]).filter(
      (s) => s.definition.miningRate > 0 && s.amount - s.lockedAmount > 0,
    );
  }
  showAssignModal.value = true;
}

async function onAssignDone() {
  showAssignModal.value = false;
  miners.value = [];
  emit('refresh');
  await loadAsteroid(props.asteroidId);
}

// ── Recall Modal ─────────────────────────────────────────────────────────────

const showRecallModal = ref(false);
const recallTarget = ref<AssignmentGroup | null>(null);

function openRecallModal(group: AssignmentGroup) {
  recallTarget.value = group;
  showRecallModal.value = true;
}

async function onRecallDone() {
  showRecallModal.value = false;
  emit('refresh');
  await loadAsteroid(props.asteroidId);
}

// ── Derived ──────────────────────────────────────────────────────────────────

const groupedAssignments = computed<AssignmentGroup[]>(() => {
  const groups = new Map<string, AssignmentGroup>();
  for (const a of asteroid.value?.assignments ?? []) {
    const key = `${a.stationId}__${a.spacecraftDefinitionId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        stationId: a.stationId,
        spacecraftDefinitionId: a.spacecraftDefinitionId,
        spacecraftName: a.spacecraftName,
        ids: [],
        totalAmount: 0,
        isOwn: a.stationId === props.stationId,
      });
    }
    const g = groups.get(key)!;
    g.ids.push(a.id);
    g.totalAmount += a.assignedAmount;
  }
  return [...groups.values()];
});

const VEIN_ALLOCATION: Record<string, number> = { primary: 0.70, secondary: 0.25, trace: 0.05 };
const STABILITY_DEGRADATION_PER_HOUR = 0.05;
const STABILITY_REGEN_PER_HOUR = 0.01;

const totalMiningPowerRaw = computed(() =>
  asteroid.value?.assignments.reduce((sum, a) => sum + a.assignedAmount * a.spacecraftMiningRate, 0) ?? 0,
);

const effectiveRateByResource = computed<Record<string, number>>(() => {
  if (!asteroid.value || totalMiningPowerRaw.value === 0) return {};
  const result: Record<string, number> = {};
  for (const vein of asteroid.value.veins) {
    const allocation = VEIN_ALLOCATION[vein.veinType] ?? 0.70;
    const cappedRate = Math.min(totalMiningPowerRaw.value * allocation * vein.purity, vein.yieldPerHour);
    result[vein.resourceKey] = (result[vein.resourceKey] ?? 0) + cappedRate * asteroid.value.stability;
  }
  return result;
});

const totalMinerCargo = computed(() =>
  asteroid.value?.assignments.reduce((s, a) => s + a.assignedAmount * a.spacecraftCargo, 0) ?? 0,
);

const totalBuffer = computed(() =>
  asteroid.value?.storage.reduce((s, r) => s + r.amount, 0) ?? 0,
);

const stabilityChangePerHour = computed<number | null>(() => {
  if (!asteroid.value || asteroid.value.assignments.length === 0) return null;
  let totalMiningLoad = 0;
  let totalYieldCap = 0;
  for (const vein of asteroid.value.veins) {
    totalMiningLoad += totalMiningPowerRaw.value * (VEIN_ALLOCATION[vein.veinType] ?? 0.70);
    totalYieldCap += vein.yieldPerHour;
  }
  if (totalYieldCap === 0) return null;
  return totalMiningLoad > totalYieldCap
    ? -STABILITY_DEGRADATION_PER_HOUR * (totalMiningLoad / totalYieldCap)
    : STABILITY_REGEN_PER_HOUR;
});

// ── Display helpers ───────────────────────────────────────────────────────────

const RESOURCE_NAMES: Record<string, string> = {
  carbon: 'Carbon', titanium: 'Titanium', hydrogenium: 'Hydrogenium',
  kyber_crystal: 'Kyber Crystal', astatine: 'Astatine',
};
const RESOURCE_COLORS: Record<string, string> = {
  carbon: '#778899', titanium: '#6699bb', hydrogenium: '#22ccee',
  kyber_crystal: '#aa33ff', astatine: '#ff5533',
};
function resourceName(key: string) { return RESOURCE_NAMES[key] ?? key.toUpperCase(); }
function resourceColor(key: string) { return RESOURCE_COLORS[key] ?? '#888888'; }

const SIZE_LABELS: Record<string, string> = {
  small: 'SMALL', medium: 'MEDIUM', large: 'LARGE', massive: 'MASSIVE',
};

const primaryVein = computed<AsteroidVein | undefined>(() =>
  asteroid.value?.veins.find((v) => v.veinType === 'primary'),
);
const panelAccentColor = computed(() =>
  primaryVein.value ? resourceColor(primaryVein.value.resourceKey) : '#00c8ff',
);

function stabilityColor(s: number) {
  if (s >= 0.8) return '#44ddaa';
  if (s >= 0.5) return '#ffdd00';
  return '#ff5533';
}
function formatCoord(n: number) { return n.toFixed(1); }
</script>

<template>
  <div
    class="absolute bottom-0 left-0 w-full cursor-default z-20 flex flex-col font-mono select-none"
    style="min-height: 220px"
  >
    <!-- Panel background -->
    <div
      class="absolute inset-0 bg-[#060c1b]/97 backdrop-blur-xl border-t-2"
      :style="`border-color:${panelAccentColor}55`"
    />
    <div class="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-cyan-400/30 z-10" />
    <div class="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cyan-400/30 z-10" />

    <div class="relative z-20 flex flex-col h-full">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 h-10 border-b border-white/6 shrink-0">
        <div class="flex items-center gap-3">
          <span
            class="w-2 h-2 rounded-full ring-1 ring-white/10 shrink-0"
            :style="primaryVein ? `background:${resourceColor(primaryVein.resourceKey)}` : 'background:#555'"
          />
          <span class="text-[9px] text-white/25 uppercase tracking-[0.35em]">Asteroid</span>
          <span class="text-sm font-semibold tracking-widest text-white/90">
            {{ primaryVein ? resourceName(primaryVein.resourceKey).toUpperCase() : '—' }}
          </span>
          <span v-if="asteroid" class="text-[9px] text-white/20 tracking-widest uppercase">
            {{ SIZE_LABELS[asteroid.size] ?? asteroid.size }}
          </span>
          <span v-if="asteroid" class="text-[9px] text-white/20 tracking-widest">
            #{{ asteroid.id.slice(0, 6) }}
          </span>
        </div>
        <button
          @click="emit('close')"
          class="w-7 h-7 flex items-center justify-center rounded text-white/50 hover:text-white/80 hover:bg-white/5 transition text-[11px]"
        >✕</button>
      </div>

      <!-- Loading / Error -->
      <div v-if="loading" class="flex-1 flex items-center justify-center">
        <span class="text-[9px] text-white/25 tracking-widest animate-pulse uppercase">Scanning…</span>
      </div>
      <div v-else-if="error" class="flex-1 flex items-center justify-center">
        <span class="text-[9px] text-red-400/60 tracking-wider">{{ error }}</span>
      </div>

      <!-- Body -->
      <div
        v-else-if="asteroid"
        class="flex-1 grid grid-cols-[1.6fr_1fr_1fr_1fr] gap-6 px-5 py-3 overflow-hidden"
      >
        <!-- Column 1: Veins -->
        <AsteroidVeinList :veins="asteroid.veins" />

        <!-- Column 2: Stability + Mining + Assignments -->
        <div class="flex flex-col gap-2 border-l border-white/5 pl-5">
          <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Stability</span>
          <span
            class="text-3xl font-semibold tabular-nums leading-none mt-1"
            :style="`color:${stabilityColor(asteroid.stability)}`"
          >{{ (asteroid.stability * 100).toFixed(0) }}%</span>
          <div class="h-1 rounded-full bg-white/6 overflow-hidden mt-1">
            <div
              class="h-full rounded-full transition-all duration-700"
              :style="`width:${(asteroid.stability * 100).toFixed(0)}%; background:${stabilityColor(asteroid.stability)}`"
            />
          </div>
          <div v-if="stabilityChangePerHour !== null" class="flex items-center gap-2 mt-1">
            <span
              class="text-[9px] tabular-nums font-semibold"
              :class="stabilityChangePerHour < 0 ? 'text-red-400/70' : 'text-emerald-400/70'"
            >
              {{ stabilityChangePerHour > 0 ? '+' : '' }}{{ (stabilityChangePerHour * 100).toFixed(2) }}%/h
            </span>
            <span
              v-if="stabilityChangePerHour < 0"
              class="text-[8px] uppercase tracking-widest text-red-400/50 border border-red-400/20 rounded px-1"
            >overloaded</span>
          </div>

          <div class="flex flex-col gap-1 mt-3">
            <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Mining</span>
            <div class="flex justify-between text-[10px] mt-0.5">
              <span class="text-white/30">Miners</span>
              <span class="text-white/60 tabular-nums">{{ groupedAssignments.reduce((s, g) => s + g.totalAmount, 0) }}</span>
            </div>
            <div v-if="totalMiningPowerRaw > 0" class="flex justify-between text-[10px]">
              <span class="text-white/30">Power</span>
              <span class="text-white/60 tabular-nums">{{ totalMiningPowerRaw.toFixed(0) }}/h</span>
            </div>
            <div v-if="totalMinerCargo > 0" class="flex justify-between text-[10px]">
              <span class="text-white/30">Cargo cap</span>
              <span class="text-white/60 tabular-nums">{{ totalMinerCargo.toFixed(0) }}</span>
            </div>
          </div>

          <div v-if="groupedAssignments.length > 0" class="flex flex-col gap-1 mt-3">
            <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Assigned</span>
            <div
              v-for="g in groupedAssignments"
              :key="`${g.stationId}__${g.spacecraftDefinitionId}`"
              class="flex items-center justify-between gap-1 text-[9px] mt-0.5"
            >
              <span class="text-white/50 truncate">{{ g.totalAmount }}× {{ g.spacecraftName }}</span>
              <button
                v-if="g.isOwn"
                @click="openRecallModal(g)"
                class="shrink-0 px-1.5 h-4 rounded text-[8px] uppercase tracking-wider text-red-400/70 border border-red-400/20 hover:bg-red-400/10 hover:text-red-400 transition"
              >Recall</button>
            </div>
          </div>
        </div>

        <!-- Column 3: Buffer -->
        <div class="flex flex-col gap-2 border-l border-white/5 pl-5">
          <div>
            <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Buffer</span>
            <p class="text-[8px] text-white/15 mt-0.5">effective rate after purity &amp; stability</p>
          </div>

          <!-- Cap bar -->
          <div v-if="totalMinerCargo > 0" class="flex flex-col gap-1">
            <div class="flex justify-between text-[9px]">
              <span class="text-white/25">{{ totalBuffer.toFixed(0) }} / {{ totalMinerCargo.toFixed(0) }}</span>
              <span
                class="tabular-nums"
                :class="totalBuffer >= totalMinerCargo ? 'text-amber-400/80' : 'text-white/20'"
              >{{ totalMinerCargo > 0 ? ((totalBuffer / totalMinerCargo) * 100).toFixed(0) : 0 }}%</span>
            </div>
            <div class="h-1 rounded-full bg-white/6 overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-700"
                :class="totalBuffer >= totalMinerCargo ? 'bg-amber-400/70' : 'bg-cyan-400/40'"
                :style="`width:${Math.min(100, totalMinerCargo > 0 ? (totalBuffer / totalMinerCargo) * 100 : 0).toFixed(0)}%`"
              />
            </div>
            <span v-if="totalBuffer >= totalMinerCargo" class="text-[8px] text-amber-400/70 uppercase tracking-widest">auto-recall pending</span>
          </div>

          <div class="flex flex-col gap-1.5 mt-1">
            <div
              v-for="s in asteroid.storage"
              :key="s.resourceKey"
              class="flex items-center justify-between text-[10px]"
            >
              <span :style="`color:${resourceColor(s.resourceKey)}`">{{ resourceName(s.resourceKey) }}</span>
              <div class="flex items-baseline gap-2">
                <span v-if="effectiveRateByResource[s.resourceKey]" class="text-[9px] text-white/25 tabular-nums">
                  +{{ effectiveRateByResource[s.resourceKey]!.toFixed(1) }}/h
                </span>
                <span class="text-white/50 tabular-nums">{{ s.amount.toFixed(1) }}</span>
              </div>
            </div>
            <div v-if="asteroid.storage.length === 0" class="text-[10px] text-white/20">Empty</div>
          </div>
        </div>

        <!-- Column 4: Location -->
        <div class="flex flex-col gap-2 border-l border-white/5 pl-5">
          <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Location</span>
          <div class="flex flex-col gap-1 mt-1">
            <div class="flex justify-between text-[10px]">
              <span class="text-white/25">X</span>
              <span class="text-white/60 tabular-nums">{{ formatCoord(asteroid.x) }}</span>
            </div>
            <div class="flex justify-between text-[10px]">
              <span class="text-white/25">Y</span>
              <span class="text-white/60 tabular-nums">{{ formatCoord(asteroid.y) }}</span>
            </div>
            <div class="flex justify-between text-[10px] mt-1">
              <span class="text-white/25">Chunk X</span>
              <span class="text-white/50 tabular-nums">{{ asteroid.chunkX }}</span>
            </div>
            <div class="flex justify-between text-[10px]">
              <span class="text-white/25">Chunk Y</span>
              <span class="text-white/50 tabular-nums">{{ asteroid.chunkY }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center gap-2 px-5 pb-3 shrink-0">
        <button
          v-if="stationId"
          @click="openAssignModal"
          class="px-3 h-6 rounded text-[9px] uppercase tracking-widest text-cyan-400/80 border border-cyan-400/25 hover:bg-cyan-400/10 hover:text-cyan-400 transition"
        >Assign Miner</button>
        <button
          v-else
          disabled
          class="px-3 h-6 rounded text-[9px] uppercase tracking-widest text-white/20 border border-white/[0.07] cursor-not-allowed"
        >Assign Miner</button>
        <div v-if="asteroid" class="ml-auto text-[8px] text-white/15 uppercase tracking-widest">
          Scanner lv.{{ asteroid.hiddenLevel }}
        </div>
      </div>
    </div>

    <!-- Modals -->
    <AssignMinerModal
      v-if="asteroid && stationId"
      :show="showAssignModal"
      :miners="miners"
      :asteroid="asteroid"
      :asteroid-id="asteroidId"
      :station-id="stationId"
      :effective-rate-by-resource="effectiveRateByResource"
      :total-mining-power-raw="totalMiningPowerRaw"
      :stability-change-per-hour="stabilityChangePerHour"
      @close="showAssignModal = false"
      @done="onAssignDone"
    />

    <RecallMinerModal
      v-if="stationId"
      :show="showRecallModal"
      :recall-target="recallTarget"
      :asteroid-id="asteroidId"
      :station-id="stationId"
      @close="showRecallModal = false"
      @done="onRecallDone"
    />
  </div>
</template>
