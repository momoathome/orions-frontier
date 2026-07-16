<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { apiClient } from '../lib/api-client';
import type { AsteroidDetail, AsteroidVein } from '@orions-frontier/shared';
import type { StationSpacecraftWithDefinition } from '@orions-frontier/shared';
import AssignMinerModal from './AssignMinerModal.vue';
import RecallMinerModal, { type AssignmentGroup } from './RecallMinerModal.vue';
import {
  resourceColor,
  resourceName,
  stabilityColor,
  calcEffectiveRateByResource,
  calcStabilityChangePerHour,
} from '../lib/mining-utils';

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
    if (err?.response?.status === 404) {
      emit('close');
      return;
    }
    error.value = 'Unable to retrieve asteroid data.';
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.asteroidId,
  (id) => loadAsteroid(id),
  { immediate: true }
);

// ── Assign Modal ─────────────────────────────────────────────────────────────

const showAssignModal = ref(false);
const miners = ref<StationSpacecraftWithDefinition[]>([]);

async function openAssignModal() {
  if (props.stationId && miners.value.length === 0) {
    const { data } = await apiClient.get(`/stations/${props.stationId}/spacecrafts`);
    miners.value = (data.data.spacecrafts as StationSpacecraftWithDefinition[]).filter(
      (s) =>
        s.definition.role === 'miner' &&
        s.definition.miningRate > 0 &&
        s.amount - s.lockedAmount > 0
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

function openRecallModal() {
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
        spacecraftMiningRate: a.spacecraftMiningRate,
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

const ownGroups = computed(() => groupedAssignments.value.filter((g) => g.isOwn));

const totalMiningPowerRaw = computed(
  () =>
    asteroid.value?.assignments.reduce(
      (sum, a) => sum + a.assignedAmount * a.spacecraftMiningRate,
      0
    ) ?? 0
);

const effectiveRateByResource = computed(() =>
  calcEffectiveRateByResource(totalMiningPowerRaw.value, asteroid.value?.veins ?? [])
);

const totalMinerCargo = computed(
  () =>
    asteroid.value?.assignments.reduce((s, a) => s + a.assignedAmount * a.spacecraftCargo, 0) ?? 0
);

const totalBuffer = computed(() => asteroid.value?.storage.reduce((s, r) => s + r.amount, 0) ?? 0);

const totalInTransit = computed(() =>
  Object.values(asteroid.value?.inTransit ?? {}).reduce((s, n) => s + n, 0)
);

const stabilityChangePerHour = computed(() =>
  calcStabilityChangePerHour(
    totalMiningPowerRaw.value,
    asteroid.value?.veins ?? [],
    (asteroid.value?.assignments.length ?? 0) > 0
  )
);

// ── Display helpers ───────────────────────────────────────────────────────────

const SIZE_LABELS: Record<string, string> = {
  small: 'SMALL',
  medium: 'MEDIUM',
  large: 'LARGE',
  massive: 'MASSIVE',
};

const VEIN_TYPE_LABELS: Record<string, string> = {
  primary: 'PRIMARY',
  secondary: 'SECONDARY',
  trace: 'TRACE',
};

const PURITY_COLORS: Record<string, string> = {
  impure: '#ff4444',
  normal: '#aaaaaa',
  rich: '#44ddaa',
  pure: '#00ccff',
  pristine: '#ffdd00',
};

const primaryVein = computed<AsteroidVein | undefined>(() =>
  asteroid.value?.veins.find((v) => v.veinType === 'primary')
);
const panelAccentColor = computed(() =>
  primaryVein.value ? resourceColor(primaryVein.value.resourceKey) : '#00c8ff'
);

function formatCoord(n: number) {
  return n.toFixed(1);
}
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
            :style="
              primaryVein
                ? `background:${resourceColor(primaryVein.resourceKey)}`
                : 'background:#555'
            "
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
        >
          ✕
        </button>
      </div>

      <!-- Loading / Error -->
      <div v-if="loading" class="flex-1 flex items-center justify-center">
        <span class="text-[9px] text-white/25 tracking-widest animate-pulse uppercase"
          >Scanning…</span
        >
      </div>
      <div v-else-if="error" class="flex-1 flex items-center justify-center">
        <span class="text-[9px] text-red-400/60 tracking-wider">{{ error }}</span>
      </div>

      <!-- Body -->
      <div
        v-else-if="asteroid"
        class="flex-1 grid grid-cols-[2fr_1.1fr] gap-6 px-5 py-3 overflow-hidden"
      >
        <!-- Column 1: Veins + Buffer (merged) -->
        <div class="flex flex-col gap-2.5 min-w-0 overflow-y-auto">
          <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Resource Veins</span>
          <div v-if="asteroid.veins.length === 0" class="text-[10px] text-white/20">
            No veins detected
          </div>
          <div
            v-for="vein in asteroid.veins"
            :key="vein.id"
            class="flex items-start gap-2.5 pb-2.5 border-b border-white/5 last:border-0 last:pb-0"
          >
            <div
              class="w-[3px] self-stretch rounded-full mt-0.5 shrink-0"
              :style="`background:${resourceColor(vein.resourceKey)}`"
            />
            <div class="flex flex-col gap-0.5 min-w-0 flex-1">
              <span class="text-[9px] text-white/25 uppercase tracking-widest">{{
                VEIN_TYPE_LABELS[vein.veinType]
              }}</span>
              <div class="flex items-baseline gap-2 flex-wrap">
                <span
                  class="text-[12px] font-medium"
                  :style="`color:${resourceColor(vein.resourceKey)}`"
                >
                  {{ resourceName(vein.resourceKey) }}
                </span>
                <span
                  class="text-[9px] uppercase tracking-wider font-semibold"
                  :style="`color:${PURITY_COLORS[vein.purityTier] ?? '#aaa'}`"
                  >{{ vein.purityTier }}
                </span>
                <span class="text-[9px] text-white/25 tabular-nums"
                  >×{{ vein.purity.toFixed(2) }}</span
                >
              </div>
              <!-- Cap vs effective Rate side by side -->
              <div class="flex items-center gap-5 mt-0.5">
                <div class="flex items-baseline gap-1.5">
                  <span class="text-[8px] text-white/18 uppercase tracking-widest">Cap</span>
                  <span class="text-[10px] text-white/30 tabular-nums"
                    >{{
                      vein.yieldPerHour >= 10
                        ? vein.yieldPerHour.toFixed(1)
                        : vein.yieldPerHour.toFixed(2)
                    }}/h</span
                  >
                </div>
                <div
                  v-if="effectiveRateByResource[vein.resourceKey]"
                  class="flex items-baseline gap-1.5"
                >
                  <span class="text-[8px] text-white/18 uppercase tracking-widest">Rate</span>
                  <span class="text-[10px] text-cyan-400/75 tabular-nums font-semibold"
                    >+{{ effectiveRateByResource[vein.resourceKey]!.toFixed(1) }}/h</span
                  >
                </div>
              </div>
              <!-- Stored + in transit -->
              <div class="flex items-center gap-2 mt-0.5">
                <span class="text-[8px] text-white/18 uppercase tracking-widest">Stored</span>
                <span class="text-[10px] text-white/45 tabular-nums">
                  {{
                    (
                      asteroid.storage.find((s) => s.resourceKey === vein.resourceKey)?.amount ?? 0
                    ).toFixed(1)
                  }}
                </span>
                <span
                  v-if="(asteroid.inTransit?.[vein.resourceKey] ?? 0) > 0"
                  class="text-[9px] text-amber-300/55 tabular-nums"
                  >+{{ (asteroid.inTransit?.[vein.resourceKey] ?? 0).toFixed(0) }}↑</span
                >
              </div>
            </div>
          </div>

          <!-- Cargo buffer bar (when miners active) -->
          <div v-if="totalMinerCargo > 0" class="mt-1 pt-2 flex flex-col gap-1">
            <div class="flex justify-between text-[9px]">
              <span class="text-white/20 uppercase tracking-widest">Miner Cargo</span>
              <span
                :class="totalBuffer >= totalMinerCargo ? 'text-amber-400/80' : 'text-white/25'"
                class="tabular-nums"
              >
                {{ totalBuffer.toFixed(0) }} / {{ totalMinerCargo.toFixed(0) }}
              </span>
            </div>
            <div class="h-0.5 rounded-full bg-white/6 overflow-hidden relative">
              <div
                class="absolute left-0 top-0 h-full rounded-full transition-all duration-700"
                :class="totalBuffer >= totalMinerCargo ? 'bg-amber-400/70' : 'bg-cyan-400/40'"
                :style="`width:${Math.min(100, (totalBuffer / totalMinerCargo) * 100).toFixed(1)}%`"
              />
              <div
                v-if="totalInTransit > 0"
                class="absolute top-0 h-full"
                :style="`left:${Math.min(100, (totalBuffer / totalMinerCargo) * 100).toFixed(1)}%; width:${Math.min(100 - (totalBuffer / totalMinerCargo) * 100, (totalInTransit / totalMinerCargo) * 100).toFixed(1)}%; background:repeating-linear-gradient(45deg,rgba(251,191,36,0.45) 0px,rgba(251,191,36,0.45) 2px,transparent 2px,transparent 5px)`"
              />
            </div>
            <span
              v-if="totalBuffer >= totalMinerCargo"
              class="text-[8px] text-amber-400/70 uppercase tracking-widest"
              >auto-recall pending</span
            >
            <span
              v-else-if="totalInTransit > 0"
              class="text-[8px] text-amber-300/50 uppercase tracking-widest"
              >in transit</span
            >
          </div>
        </div>

        <!-- Column 2: Stability + Operations -->
        <div class="flex flex-col gap-2 border-l border-white/5 pl-5 overflow-y-auto">
          <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Stability</span>
          <span
            class="text-3xl font-semibold tabular-nums leading-none mt-1"
            :style="`color:${stabilityColor(asteroid.stability)}`"
            >{{ (asteroid.stability * 100).toFixed(0) }}%</span
          >
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
              >{{ stabilityChangePerHour > 0 ? '+' : ''
              }}{{ (stabilityChangePerHour * 100).toFixed(2) }}%/h</span
            >
            <span
              v-if="stabilityChangePerHour < 0"
              class="text-[8px] uppercase tracking-widest text-red-400/50 border border-red-400/20 rounded px-1"
              >overloaded</span
            >
          </div>

          <div class="flex flex-col gap-1 mt-3">
            <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Mining</span>
            <div class="flex justify-between text-[10px] mt-0.5">
              <span class="text-white/30">Miners</span>
              <span class="text-white/60 tabular-nums">{{
                groupedAssignments.reduce((s, g) => s + g.totalAmount, 0)
              }}</span>
            </div>
            <div v-if="totalMiningPowerRaw > 0" class="flex justify-between text-[10px]">
              <span class="text-white/30">Rate</span>
              <span class="text-white/60 tabular-nums">{{ totalMiningPowerRaw.toFixed(0) }}/h</span>
            </div>
            <div v-if="totalMinerCargo > 0" class="flex justify-between text-[10px]">
              <span class="text-white/30">Cargo</span>
              <span class="text-white/60 tabular-nums">{{ totalMinerCargo.toFixed(0) }}</span>
            </div>
          </div>

          <!-- Assigned groups: inline names, single Recall button -->
          <div v-if="groupedAssignments.length > 0" class="flex flex-col gap-2 mt-3">
            <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Assigned</span>
            <p class="text-[9px] text-white/45 leading-relaxed">
              <template v-for="(g, i) in groupedAssignments" :key="g.spacecraftDefinitionId">
                <span>{{ g.totalAmount }}×&nbsp;{{ g.spacecraftName }}</span>
                <span v-if="i < groupedAssignments.length - 1" class="text-white/20"> · </span>
              </template>
            </p>
            <button
              v-if="ownGroups.length > 0"
              @click="openRecallModal()"
              class="w-full h-6 rounded text-[8px] uppercase tracking-widest text-red-400 border border-red-400/35 hover:bg-red-400/12 hover:border-red-400/65 transition font-semibold mt-0.5"
            >
              ↩ Recall
            </button>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center gap-3 px-5 pb-3 pt-1 shrink-0 border-t border-white/5">
        <button
          v-if="stationId"
          @click="openAssignModal"
          class="px-4 h-7 rounded text-[9px] uppercase tracking-widest text-cyan-400 border border-cyan-400/40 hover:bg-cyan-400/12 hover:border-cyan-400/70 transition font-semibold"
        >
          ⊕ Assign Miner
        </button>
        <button
          v-else
          disabled
          class="px-4 h-7 rounded text-[9px] uppercase tracking-widest text-white/20 border border-white/[0.07] cursor-not-allowed"
        >
          ⊕ Assign Miner
        </button>

        <!-- Location compact -->
        <div
          v-if="asteroid"
          class="ml-auto flex items-center gap-2 text-[8px] text-white/20 tabular-nums uppercase tracking-wider"
        >
          <span>X&nbsp;{{ formatCoord(asteroid.x) }}</span>
          <span class="text-white/10">·</span>
          <span>Y&nbsp;{{ formatCoord(asteroid.y) }}</span>
          <span class="text-white/10">·</span>
          <span class="text-white/15">{{ asteroid.chunkX }}:{{ asteroid.chunkY }}</span>
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
      v-if="stationId && asteroid"
      :show="showRecallModal"
      :own-groups="ownGroups"
      :asteroid="asteroid"
      :asteroid-id="asteroidId"
      :station-id="stationId"
      :total-mining-power-raw="totalMiningPowerRaw"
      :effective-rate-by-resource="effectiveRateByResource"
      :stability-change-per-hour="stabilityChangePerHour"
      @close="showRecallModal = false"
      @done="onRecallDone"
    />
  </div>
</template>
