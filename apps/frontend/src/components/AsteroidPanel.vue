<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { apiClient } from '../lib/api-client';
import type { AsteroidDetail, AsteroidVein } from '@orions-frontier/shared';
import type { StationSpacecraftWithDefinition } from '@orions-frontier/shared';

const props = defineProps<{
  asteroidId: string;
  stationId: string | null;
}>();

const emit = defineEmits<{ close: [] }>();

// ── Resource / vein display maps ─────────────────────────────────────────────

const RESOURCE_NAMES: Record<string, string> = {
  carbon: 'Carbon',
  titanium: 'Titanium',
  hydrogenium: 'Hydrogenium',
  kyber_crystal: 'Kyber Crystal',
  astatine: 'Astatine',
};

const RESOURCE_CSS_COLORS: Record<string, string> = {
  carbon: '#778899',
  titanium: '#6699bb',
  hydrogenium: '#22ccee',
  kyber_crystal: '#aa33ff',
  astatine: '#ff5533',
};

const PURITY_COLORS: Record<string, string> = {
  impure: '#ff4444',
  normal: '#aaaaaa',
  rich: '#44ddaa',
  pure: '#00ccff',
  pristine: '#ffdd00',
};

const VEIN_LABELS: Record<string, string> = {
  primary: 'PRIMARY',
  secondary: 'SECONDARY',
  trace: 'TRACE',
};

const SIZE_LABELS: Record<string, string> = {
  small: 'SMALL',
  medium: 'MEDIUM',
  large: 'LARGE',
  massive: 'MASSIVE',
};

function resourceName(key: string) {
  return RESOURCE_NAMES[key] ?? key.toUpperCase();
}
function resourceColor(key: string) {
  return RESOURCE_CSS_COLORS[key] ?? '#888888';
}
function purityColor(tier: string) {
  return PURITY_COLORS[tier] ?? '#888888';
}

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
  } catch {
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
const selectedDefId = ref('');
const assignAmount = ref(1);
const assignError = ref<string | null>(null);
const assigning = ref(false);

async function openAssignModal() {
  assignError.value = null;
  assigning.value = false;
  assignAmount.value = 1;

  if (props.stationId && miners.value.length === 0) {
    const { data } = await apiClient.get(`/stations/${props.stationId}/spacecrafts`);
    miners.value = (data.data.spacecrafts as StationSpacecraftWithDefinition[]).filter(
      (s) => s.definition.miningRate > 0
    );
  }
  selectedDefId.value = miners.value[0]?.definition.id ?? '';
  showAssignModal.value = true;
}

async function submitAssign() {
  if (!props.stationId || !selectedDefId.value) return;
  assigning.value = true;
  assignError.value = null;
  try {
    await apiClient.post(`/asteroids/${props.asteroidId}/assignments`, {
      stationId: props.stationId,
      spacecraftDefinitionId: selectedDefId.value,
      assignedAmount: assignAmount.value,
    });
    showAssignModal.value = false;
    await loadAsteroid(props.asteroidId);
  } catch (err: any) {
    assignError.value = err?.response?.data?.message ?? 'Assignment failed';
  } finally {
    assigning.value = false;
  }
}

// ── Assignment Groups + Recall Modal ─────────────────────────────────────────

interface AssignmentGroup {
  stationId: string;
  spacecraftDefinitionId: string;
  spacecraftName: string;
  ids: string[];
  totalAmount: number;
  isOwn: boolean;
}

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

const showRecallModal = ref(false);
const recallTarget = ref<AssignmentGroup | null>(null);
const recallAmount = ref(1);
const recallError = ref<string | null>(null);
const recalling = ref(false);

function openRecallModal(group: AssignmentGroup) {
  recallTarget.value = group;
  recallAmount.value = group.totalAmount;
  recallError.value = null;
  recalling.value = false;
  showRecallModal.value = true;
}

async function submitRecall() {
  if (!recallTarget.value || !props.stationId) return;
  const group = recallTarget.value;
  recalling.value = true;
  recallError.value = null;
  const headers = { 'x-station-id': props.stationId };
  try {
    if (recallAmount.value >= group.totalAmount) {
      // Alle Rows dieser Gruppe löschen
      for (const id of group.ids) {
        await apiClient.delete(`/asteroids/${props.asteroidId}/assignments/${id}`, { headers });
      }
    } else {
      // Menge reduzieren via PUT auf dem ersten Row
      await apiClient.put(`/asteroids/${props.asteroidId}/assignments/${group.ids[0]}`, {
        assignedAmount: group.totalAmount - recallAmount.value,
      }, { headers });
    }
    showRecallModal.value = false;
    await loadAsteroid(props.asteroidId);
  } catch (err: any) {
    recallError.value = err?.response?.data?.message ?? 'Recall failed';
  } finally {
    recalling.value = false;
  }
}

// ── Derived ──────────────────────────────────────────────────────────────────

const primaryVein = computed<AsteroidVein | undefined>(() =>
  asteroid.value?.veins.find((v) => v.veinType === 'primary')
);

const panelAccentColor = computed(() =>
  primaryVein.value ? resourceColor(primaryVein.value.resourceKey) : '#00c8ff'
);

function stabilityColor(s: number) {
  if (s >= 0.8) return '#44ddaa';
  if (s >= 0.5) return '#ffdd00';
  return '#ff5533';
}

function formatYield(y: number) {
  return y >= 10 ? y.toFixed(1) : y.toFixed(2);
}

function formatCoord(n: number) {
  return n.toFixed(1);
}

function veinTotalYield(vein: AsteroidVein) {
  return formatYield(vein.yieldPerHour);
}
</script>

<template>
  <div
    class="absolute bottom-0 left-0 w-full z-20 flex flex-col font-mono select-none"
    style="min-height: 220px"
  >
    <!-- Panel background -->
    <div
      class="absolute inset-0 bg-[#060c1b]/97 backdrop-blur-xl border-t-2"
      :style="`border-color:${panelAccentColor}55`"
    />

    <!-- Corner accents -->
    <div class="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-cyan-400/30 z-10" />
    <div class="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cyan-400/30 z-10" />

    <!-- Content -->
    <div class="relative z-20 flex flex-col h-full">
      <!-- ── Header ──────────────────────────────────────────────────────────── -->
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
          <span v-if="asteroid" class="text-[9px] text-white/20 tracking-widest"
            >#{{ asteroid.id.slice(0, 6) }}</span
          >
        </div>
        <button
          @click="emit('close')"
          class="w-7 h-7 flex items-center justify-center rounded text-white/50 hover:text-white/80 hover:bg-white/5 transition text-[11px]"
        >
          ✕
        </button>
      </div>

      <!-- ── Loading / Error ─────────────────────────────────────────────────── -->
      <div v-if="loading" class="flex-1 flex items-center justify-center">
        <span class="text-[9px] text-white/25 tracking-widest animate-pulse uppercase"
          >Scanning…</span
        >
      </div>
      <div v-else-if="error" class="flex-1 flex items-center justify-center">
        <span class="text-[9px] text-red-400/60 tracking-wider">{{ error }}</span>
      </div>

      <!-- ── Body ───────────────────────────────────────────────────────────── -->
      <div
        v-else-if="asteroid"
        class="flex-1 grid grid-cols-[1.6fr_1fr_1fr_1fr] gap-6 px-5 py-3 overflow-hidden"
      >
        <!-- Column 1: Veins -->
        <div class="flex flex-col gap-2.5 min-w-0">
          <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Resource Veins</span>
          <div
            v-for="vein in asteroid.veins"
            :key="vein.id"
            class="flex items-start gap-2.5 pb-2.5 border-b border-white/5 last:border-0 last:pb-0"
          >
            <!-- Resource color stripe -->
            <div
              class="w-[3px] self-stretch rounded-full mt-0.5 shrink-0"
              :style="`background:${resourceColor(vein.resourceKey)}`"
            />
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="text-[9px] text-white/25 uppercase tracking-widest">
                {{ VEIN_LABELS[vein.veinType] }}
              </span>
              <div class="flex items-baseline gap-2 flex-wrap">
                <span
                  class="text-[12px] font-medium"
                  :style="`color:${resourceColor(vein.resourceKey)}`"
                >
                  {{ resourceName(vein.resourceKey) }}
                </span>
                <span class="text-[10px] text-white/40 tabular-nums"
                  >{{ veinTotalYield(vein) }}/h</span
                >
              </div>
              <div class="flex items-center gap-1.5">
                <span
                  class="text-[9px] uppercase tracking-widest font-semibold"
                  :style="`color:${purityColor(vein.purityTier)}`"
                >
                  {{ vein.purityTier }}
                </span>
                <span class="text-[9px] text-white/30 tabular-nums"
                  >×{{ vein.purity.toFixed(2) }}</span
                >
              </div>
            </div>
          </div>
          <div v-if="asteroid.veins.length === 0" class="text-[10px] text-white/20">
            No veins detected
          </div>
        </div>

        <!-- Column 2: Stability -->
        <div class="flex flex-col gap-2 border-l border-white/5 pl-5">
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
          <!-- Mining counts below stability -->
          <div class="flex flex-col gap-1 mt-3">
            <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Mining</span>
            <div class="flex justify-between text-[10px] mt-0.5">
              <span class="text-white/30">Miners</span>
              <span class="text-white/60 tabular-nums">{{ groupedAssignments.reduce((s, g) => s + g.totalAmount, 0) }}</span>
            </div>
            <div class="flex justify-between text-[10px]">
              <span class="text-white/30">Buffer</span>
              <span class="text-white/60 tabular-nums">
                {{
                  asteroid.storage.length > 0
                    ? asteroid.storage.reduce((s, r) => s + r.amount, 0).toFixed(0)
                    : '0'
                }}
              </span>
            </div>
          </div>

          <!-- Assignments list -->
          <div v-if="groupedAssignments.length > 0" class="flex flex-col gap-1 mt-3">
            <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Assigned</span>
            <div
              v-for="g in groupedAssignments"
              :key="`${g.stationId}__${g.spacecraftDefinitionId}`"
              class="flex items-center justify-between gap-1 text-[9px] mt-0.5"
            >
              <span class="text-white/50 truncate">
                {{ g.totalAmount }}× {{ g.spacecraftName }}
              </span>
              <button
                v-if="g.isOwn"
                @click="openRecallModal(g)"
                class="shrink-0 px-1.5 h-4 rounded text-[8px] uppercase tracking-wider text-red-400/70 border border-red-400/20 hover:bg-red-400/10 hover:text-red-400 transition"
              >
                Recall
              </button>
            </div>
          </div>
        </div>

        <!-- Column 3: Buffer breakdown -->
        <div class="flex flex-col gap-2 border-l border-white/5 pl-5">
          <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Buffer</span>
          <div class="flex flex-col gap-1.5 mt-1">
            <div
              v-for="s in asteroid.storage"
              :key="s.resourceKey"
              class="flex items-center justify-between text-[10px]"
            >
              <span :style="`color:${resourceColor(s.resourceKey)}`">
                {{ resourceName(s.resourceKey) }}
              </span>
              <span class="text-white/50 tabular-nums">{{ s.amount.toFixed(1) }}</span>
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

      <!-- ── Footer ─────────────────────────────────────────────────────────── -->
      <div class="flex items-center gap-2 px-5 pb-3 shrink-0">
        <button
          v-if="stationId"
          @click="openAssignModal"
          class="px-3 h-6 rounded text-[9px] uppercase tracking-widest text-cyan-400/80 border border-cyan-400/25 hover:bg-cyan-400/10 hover:text-cyan-400 transition"
        >
          Assign Miner
        </button>
        <button
          v-else
          disabled
          class="px-3 h-6 rounded text-[9px] uppercase tracking-widest text-white/20 border border-white/[0.07] cursor-not-allowed"
        >
          Assign Miner
        </button>
        <div v-if="asteroid" class="ml-auto text-[8px] text-white/15 uppercase tracking-widest">
          Scanner lv.{{ asteroid.hiddenLevel }}
        </div>
      </div>
    </div>

    <!-- ── Assign Modal ──────────────────────────────────────────────────────── -->
    <transition
      enter-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showAssignModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click.self="showAssignModal = false"
      >
        <div class="bg-[#060c1b] border border-cyan-400/20 rounded p-5 w-72 flex flex-col gap-4 font-mono">
          <div class="flex items-center justify-between">
            <span class="text-[10px] text-white/50 uppercase tracking-widest">Assign Miner</span>
            <button @click="showAssignModal = false" class="text-white/30 hover:text-white/60 text-[11px]">✕</button>
          </div>

          <div v-if="miners.length === 0" class="text-[10px] text-white/30 text-center py-3">
            No mining spacecraft at station
          </div>

          <template v-else>
            <!-- Spacecraft select -->
            <div class="flex flex-col gap-1.5">
              <label class="text-[9px] text-white/25 uppercase tracking-wider">Spacecraft</label>
              <select
                v-model="selectedDefId"
                class="bg-white/5 border border-white/10 rounded px-2 h-7 text-[11px] text-white/80 focus:outline-none focus:border-cyan-400/40"
              >
                <option v-for="m in miners" :key="m.definition.id" :value="m.definition.id">
                  {{ m.definition.name }} ({{ m.definition.miningRate }}/h · ×{{ m.amount }})
                </option>
              </select>
            </div>

            <!-- Amount -->
            <div class="flex flex-col gap-1.5">
              <label class="text-[9px] text-white/25 uppercase tracking-wider">Amount</label>
              <input
                v-model.number="assignAmount"
                type="number"
                min="1"
                class="bg-white/5 border border-white/10 rounded px-2 h-7 text-[11px] text-white/80 focus:outline-none focus:border-cyan-400/40 tabular-nums"
              />
            </div>

            <div v-if="assignError" class="text-[9px] text-red-400/80">{{ assignError }}</div>

            <button
              @click="submitAssign"
              :disabled="assigning || !selectedDefId"
              class="h-7 rounded text-[9px] uppercase tracking-widest bg-cyan-400/10 text-cyan-400/80 border border-cyan-400/25 hover:bg-cyan-400/15 hover:text-cyan-400 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {{ assigning ? 'Assigning…' : 'Assign' }}
            </button>
          </template>
        </div>
      </div>
    </transition>

    <!-- ── Recall Modal ───────────────────────────────────────────────────────── -->
    <transition
      enter-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showRecallModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click.self="showRecallModal = false"
      >
        <div class="bg-[#060c1b] border border-red-400/20 rounded p-5 w-72 flex flex-col gap-4 font-mono">
          <div class="flex items-center justify-between">
            <span class="text-[10px] text-white/50 uppercase tracking-widest">Recall Miners</span>
            <button @click="showRecallModal = false" class="text-white/30 hover:text-white/60 text-[11px]">✕</button>
          </div>

          <div v-if="recallTarget" class="flex flex-col gap-3">
            <div class="text-[10px] text-white/35">
              {{ recallTarget.spacecraftName }}
              <span class="text-white/20">— {{ recallTarget.totalAmount }} assigned</span>
            </div>

            <div class="flex flex-col gap-1.5">
              <label class="text-[9px] text-white/25 uppercase tracking-wider">Amount to Recall</label>
              <input
                v-model.number="recallAmount"
                type="number"
                :min="1"
                :max="recallTarget.totalAmount"
                class="bg-white/5 border border-white/10 rounded px-2 h-7 text-[11px] text-white/80 focus:outline-none focus:border-red-400/40 tabular-nums"
              />
            </div>

            <div v-if="recallError" class="text-[9px] text-red-400/80">{{ recallError }}</div>

            <button
              @click="submitRecall"
              :disabled="recalling || recallAmount < 1"
              class="h-7 rounded text-[9px] uppercase tracking-widest bg-red-400/10 text-red-400/80 border border-red-400/25 hover:bg-red-400/15 hover:text-red-400 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {{ recalling ? 'Recalling…' : `Recall ${recallAmount}` }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>
