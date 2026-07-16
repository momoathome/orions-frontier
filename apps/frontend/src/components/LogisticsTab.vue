<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { apiClient } from '../lib/api-client';
import { wsClient } from '../lib/ws-client';
import type { AsteroidDetail, StationSpacecraftWithDefinition } from '@orions-frontier/shared';
import AsteroidPanel from './AsteroidPanel.vue';
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

type TripPurpose = 'mine' | 'transport' | 'recall' | 'return' | 'combat';

interface Trip {
  id: string;
  groupSize: number;
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  departedAt: string;
  arrivesAt: string;
  purpose: TripPurpose;
  cargoManifest: Record<string, number> | null;
  spacecraft: { role: string; speed: number; cargo: number; name: string } | null;
}

interface LogisticsAlert {
  severity: 'warning' | 'critical';
  message: string;
}

// ── Props & Emits ────────────────────────────────────────────────────────────

const props = defineProps<{ stationId: string }>();
const emit = defineEmits<{
  queueCount: [count: number];
  totalMiningRate: [rate: number];
}>();

// ── State ────────────────────────────────────────────────────────────────────

const assignments = ref<StationMiningAssignment[]>([]);
const allDetails = ref<Record<string, AsteroidDetail>>({});
const fleet = ref<StationSpacecraftWithDefinition[]>([]);
const trips = ref<Trip[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const tableExpanded = ref(false);
const selectedAsteroidId = ref<string | null>(null);

const recallTrips24h = ref(0);
const recallShips24h = ref(0);

// ── Grouping (reused logic) ───────────────────────────────────────────────────

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

// ── Rate helpers (reused logic) ───────────────────────────────────────────────

function groupMiningPower(groupAssignments: StationMiningAssignment[]): number {
  return groupAssignments.reduce((sum, a) => sum + a.assignedAmount * a.spacecraftMiningRate, 0);
}

function computeEffectiveRate(
  detail: AsteroidDetail,
  groupAssignments: StationMiningAssignment[]
): number {
  return calcTotalEffectiveRate(groupMiningPower(groupAssignments), detail.veins);
}

// ── Global mining output KPI ──────────────────────────────────────────────────

const globalMiningOutput = computed(() => {
  let total = 0;
  for (const group of asteroidGroups.value) {
    const detail = allDetails.value[group.asteroidId];
    if (detail) total += computeEffectiveRate(detail, group.assignments);
  }
  return total;
});

/** Effective output per resource key across all asteroids, sorted descending. */
const globalMiningByResource = computed(() => {
  const map: Record<string, number> = {};
  for (const group of asteroidGroups.value) {
    const detail = allDetails.value[group.asteroidId];
    if (!detail) continue;
    const power = groupMiningPower(group.assignments);
    const byRes = calcEffectiveRateByResource(power, detail.veins);
    for (const [key, rate] of Object.entries(byRes)) {
      map[key] = (map[key] ?? 0) + rate;
    }
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
});

watch(globalMiningOutput, (rate) => emit('totalMiningRate', rate), { immediate: true });
emit('queueCount', 0);

// ── Fleet KPIs ────────────────────────────────────────────────────────────────

const transporterFleet = computed(() =>
  fleet.value.filter((e) => e.definition.role === 'transporter')
);

const totalTransporters = computed(() =>
  transporterFleet.value.reduce((sum, e) => sum + e.amount, 0)
);

const lockedTransporters = computed(() =>
  transporterFleet.value.reduce((sum, e) => sum + e.lockedAmount, 0)
);

const idleTransporters = computed(() => totalTransporters.value - lockedTransporters.value);

const transportUtilization = computed(() =>
  totalTransporters.value > 0
    ? Math.round((lockedTransporters.value / totalTransporters.value) * 100)
    : 0
);

// ── Trip KPIs ─────────────────────────────────────────────────────────────────

const transporterTrips = computed(() =>
  stationTrips.value.filter(
    (t) =>
      (t.purpose === 'transport' || t.purpose === 'return') && t.spacecraft?.role === 'transporter'
  )
);

const transportLoad = computed(() => {
  if (transportCapacity.value <= 0) return 0;

  return Math.round((globalMiningOutput.value / transportCapacity.value) * 100);
});

// ── Miner fleet state counts ──────────────────────────────────────────────────

const minerFleet = computed(() => fleet.value.filter((e) => e.definition.role === 'miner'));

const totalMiners = computed(() => minerFleet.value.reduce((sum, e) => sum + e.amount, 0));
const lockedMiners = computed(() => minerFleet.value.reduce((sum, e) => sum + e.lockedAmount, 0));
const idleMiners = computed(() => totalMiners.value - lockedMiners.value);

const travelingMiners = computed(() =>
  stationTrips.value
    .filter((t) => t.purpose === 'mine' && t.spacecraft?.role === 'miner')
    .reduce((sum, t) => sum + t.groupSize, 0)
);

const recallingMiners = computed(() =>
  stationTrips.value
    .filter((t) => t.purpose === 'recall' && t.spacecraft?.role === 'miner')
    .reduce((sum, t) => sum + t.groupSize, 0)
);

const activeMiningMiners = computed(() =>
  assignments.value.reduce((sum, a) => sum + a.assignedAmount, 0)
);

const minerUtilization = computed(() =>
  totalMiners.value > 0
    ? Math.round(
        ((lockedMiners.value + travelingMiners.value + recallingMiners.value) / totalMiners.value) *
          100
      )
    : 0
);

// ── Station-scoped trips ─────────────────────────────────────────────────────

/** Only trips that originate from or return to this station. */
const stationTrips = computed(() =>
  trips.value.filter((t) => t.fromId === props.stationId || t.toId === props.stationId)
);

const transportersReturning = computed(() =>
  stationTrips.value
    .filter(
      (t) =>
        t.purpose === 'return' && t.spacecraft?.role === 'transporter' && t.cargoManifest !== null
    )
    .reduce((sum, t) => sum + t.groupSize, 0)
);

/**
 * Estimate transport capacity in units/h.
 * For each active transporter trip we know: groupSize, cargo, and trip duration.
 * Throughput ≈ groupSize × cargo / (2 × tripDurationHours)
 * (÷2 because each trip is one leg of the round trip)
 */
const transportCapacity = computed(() => {
  let total = 0;
  for (const t of transporterTrips.value) {
    const cargo = t.spacecraft?.cargo ?? 0;
    const durationMs = new Date(t.arrivesAt).getTime() - new Date(t.departedAt).getTime();
    const durationHours = durationMs / 3_600_000;
    if (durationHours > 0 && cargo > 0) {
      total += (t.groupSize * cargo) / (2 * durationHours);
    }
  }
  return total;
});

/** Sum of all resources physically in transit right now (return trips with cargo). */
const cargoInTransit = computed(() =>
  stationTrips.value
    .filter(
      (t) =>
        t.purpose === 'return' && t.spacecraft?.role === 'transporter' && t.cargoManifest !== null
    )
    .reduce((sum, t) => {
      if (!t.cargoManifest) return sum;
      return sum + Object.values(t.cargoManifest).reduce((s, v) => s + v, 0);
    }, 0)
);

const bufferDelta = computed(() => globalMiningOutput.value - transportCapacity.value);

// ── Per-asteroid buffer stats ─────────────────────────────────────────────────

interface AsteroidRow {
  group: AsteroidGroup;
  detail: AsteroidDetail | null;
  miningRate: number;
  bufferTotal: number;
  /** Real recall threshold: total cargo capacity of assigned miners. 0 if unknown. */
  recallThreshold: number;
  bufferFillPct: number;
  /** hours until self-recall triggers; null if not accumulating or threshold unknown */
  fillEtaHours: number | null;
  transporterCount: number;
  stabilityChange: number | null;
  status: 'healthy' | 'warning' | 'critical';
}

const asteroidRows = computed<AsteroidRow[]>(() =>
  asteroidGroups.value.map((group) => {
    const detail = allDetails.value[group.asteroidId] ?? null;
    const miningRate = detail ? computeEffectiveRate(detail, group.assignments) : 0;

    const bufferTotal = detail ? detail.storage.reduce((sum, s) => sum + s.amount, 0) : 0;

    // Real threshold: buffer >= miner cargo cap → self-recall triggers
    const recallThreshold = detail
      ? detail.assignments.reduce((sum, a) => sum + a.assignedAmount * a.spacecraftCargo, 0)
      : 0;
    const bufferFillPct =
      recallThreshold > 0 ? Math.min(100, (bufferTotal / recallThreshold) * 100) : 0;

    // In-transit resources being picked up for this asteroid
    const inTransitTotal = detail
      ? Object.values(detail.inTransit ?? {}).reduce((sum, v) => sum + v, 0)
      : 0;
    const netAccumulation = miningRate - inTransitTotal;
    const remaining = recallThreshold > 0 ? recallThreshold - bufferTotal : 0;
    const fillEtaHours =
      recallThreshold > 0 && netAccumulation > 0 && remaining > 0
        ? remaining / netAccumulation
        : null;

    // Count transporter trips targeting this asteroid
    const transporterCount = stationTrips.value.filter(
      (t) =>
        (t.purpose === 'transport' && t.toId === group.asteroidId) ||
        (t.purpose === 'return' && t.fromId === group.asteroidId)
    ).length;

    const miningPower = groupMiningPower(group.assignments);
    const stabilityChange = detail
      ? calcStabilityChangePerHour(miningPower, detail.veins, group.assignments.length > 0)
      : null;

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (bufferFillPct >= 80 || (fillEtaHours !== null && fillEtaHours < 1)) {
      status = 'critical';
    } else if (bufferFillPct >= 60 || group.asteroidStability < 0.5) {
      status = 'warning';
    }

    return {
      group,
      detail,
      miningRate,
      bufferTotal,
      recallThreshold,
      bufferFillPct,
      fillEtaHours,
      transporterCount,
      stabilityChange,
      status,
    };
  })
);

// ── Alerts ────────────────────────────────────────────────────────────────────

const alerts = computed<LogisticsAlert[]>(() => {
  const list: LogisticsAlert[] = [];

  // Unstable asteroids
  const degrading = asteroidRows.value.filter(
    (r) => r.stabilityChange !== null && r.stabilityChange < 0 && r.group.asteroidStability < 0.4
  ).length;
  if (degrading > 0) {
    list.push({
      severity: 'critical',
      message: `${degrading} asteroid${degrading > 1 ? 's' : ''} critically unstable`,
    });
  }

  const nearFull = asteroidRows.value.filter(
    (r) => r.bufferFillPct >= 80 && (r.fillEtaHours === null || r.fillEtaHours >= 1)
  ).length;
  if (nearFull > 0) {
    list.push({
      severity: 'warning',
      message: `${nearFull} asteroid buffer${nearFull > 1 ? 's' : ''} ≥ 80% full`,
    });
  }

  // Transport overloaded
  if (bufferDelta.value > 0 && globalMiningOutput.value > 0) {
    const overloadPct = Math.round((bufferDelta.value / globalMiningOutput.value) * 100);
    list.push({
      severity: overloadPct > 20 ? 'critical' : 'warning',
      message: `Transport network overloaded (+${overloadPct}% undelivered)`,
    });
  }

  // Traveling miners
  if (travelingMiners.value > 0) {
    list.push({
      severity: 'warning',
      message: `${travelingMiners.value} miner${travelingMiners.value > 1 ? 's' : ''} traveling to asteroid`,
    });
  }

  // Recalling miners
  if (recallingMiners.value > 0) {
    list.push({
      severity: 'warning',
      message: `${recallingMiners.value} miner${recallingMiners.value > 1 ? 's' : ''} returning from asteroid`,
    });
  }

  return list;
});

// ── Formatting helpers ────────────────────────────────────────────────────────

/** Abbreviated (k) — used in compact table cells. */
function fmtRate(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return Math.round(n).toString();
}

/** Full locale-formatted integer with thousands separator — used in KPI cards. */
function fmtNum(n: number): string {
  return Math.round(Math.abs(n)).toLocaleString();
}

function fmtEta(hours: number | null): string {
  if (hours === null) return '–';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}

function shortId(asteroidId: string): string {
  return asteroidId.slice(-6).toUpperCase();
}

// ── Data loading ──────────────────────────────────────────────────────────────

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

async function loadAll(force = false) {
  if (!force) loading.value = true;
  error.value = null;
  try {
    const [assignmentsRes, fleetRes, tripsRes, recallRes] = await Promise.all([
      apiClient.get(`/stations/${props.stationId}/mining-assignments`),
      apiClient.get(`/stations/${props.stationId}/spacecrafts`),
      apiClient.get('/me/trips'),
      apiClient.get(`/stations/${props.stationId}/recall-stats`),
    ]);

    assignments.value = assignmentsRes.data.data.assignments;
    fleet.value = fleetRes.data.data.spacecrafts;
    trips.value = tripsRes.data.data ?? [];
    recallTrips24h.value = recallRes.data.data.recallTrips;
    recallShips24h.value = recallRes.data.data.recallShips;

    // Prefetch details for all assigned asteroids
    const ids = [...new Set(assignments.value.map((a) => a.asteroidId))];
    // Clear stale details when force-refreshing
    if (force) allDetails.value = {};
    await Promise.all(ids.map((id) => loadDetail(id)));
  } catch {
    error.value = 'Failed to load logistics data';
  } finally {
    loading.value = false;
  }
}

loadAll();

const unsubMining = wsClient.on('mining_tick_completed', () => loadAll(true));
const unsubTransport = wsClient.on('transport_tick_completed', () => loadAll(true));

onUnmounted(() => {
  unsubMining();
  unsubTransport();
});
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
    <!-- ── Loading ──────────────────────────────────────────────────────────── -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="flex items-center gap-2 text-cyan-400/50 text-[10px] uppercase tracking-widest">
        <span
          class="inline-block w-3 h-3 border border-cyan-400/50 border-t-cyan-400 rounded-full animate-spin"
        />
        Loading…
      </div>
    </div>

    <!-- ── Error ─────────────────────────────────────────────────────────────── -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center">
      <p class="text-rose-400/60 text-[10px] uppercase tracking-widest">{{ error }}</p>
    </div>

    <!-- ── Dashboard ─────────────────────────────────────────────────────────── -->
    <div v-else class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 p-3">
      <!-- ── 1. Summary Bar ──────────────────────────────────────────────────── -->
      <div class="grid grid-cols-6 gap-1.5">
        <!-- Mining Output -->
        <div class="bg-white/3 border border-white/6 rounded px-2 py-1.5 flex flex-col gap-0.5">
          <span class="text-[7px] text-white/25 uppercase tracking-[0.25em] leading-none">
            Mining
          </span>
          <span class="text-[13px] font-bold tabular-nums text-amber-300 leading-tight">
            +{{ fmtNum(globalMiningOutput) }}/h
          </span>
          <!-- Per-resource pills -->
          <div class="flex gap-2 mt-2">
            <div
              v-for="[key, rate] in globalMiningByResource"
              :key="key"
              class="flex items-center gap-1 px-1.5 py-0.5 rounded border"
              :style="{
                backgroundColor: resourceColor(key) + '18',
                borderColor: resourceColor(key) + '44',
              }"
            >
              <img :src="`/assets/resources/${key}.png`" class="w-3 h-3 shrink-0 object-contain" />
              <span
                class="text-[8px] tabular-nums font-semibold leading-none"
                :style="{ color: resourceColor(key) }"
              >
                +{{ fmtRate(rate) }}/h
              </span>
            </div>
          </div>
        </div>

        <!-- Transport Capacity -->
        <div class="bg-white/3 border border-white/6 rounded px-2 py-1.5 flex flex-col gap-0.5">
          <span class="text-[7px] text-white/25 uppercase tracking-[0.25em] leading-none">
            Transport
          </span>
          <div class="flex items-center justify-center gap-2">
            <span class="text-[14px] font-bold tabular-nums text-sky-300 leading-tight">
              {{ fmtNum(cargoInTransit) }}
            </span>
          </div>
          <span class="text-[8px] text-white/20 leading-none mt-1">in Transit</span>
        </div>

        <!-- Miners -->
        <div class="bg-amber-500/5 border border-amber-500/20 rounded px-2 py-2">
          <div class="flex items-end justify-between">
            <div>
              <div class="text-[7px] uppercase tracking-[0.25em] text-white/25">Miners</div>
              <div class="text-[14px] leading-none font-bold text-amber-300 tabular-nums">
                {{ activeMiningMiners }}
              </div>
            </div>
            <div class="text-[10px] text-white/30 tabular-nums">/ {{ totalMiners }}</div>
          </div>
          <!-- Utilization bar -->
          <div class="mt-2 h-1 rounded-full bg-white/6 overflow-hidden">
            <div
              class="h-full bg-amber-400 rounded-full"
              :style="{ width: minerUtilization + '%' }"
            />
          </div>
          <div class="flex items-center justify-between mt-2 text-[8px]">
            <span class="text-white/20"> {{ travelingMiners }} travel </span>
            <span :class="idleMiners > 0 ? 'text-amber-300/80' : 'text-white/20'">
              {{ idleMiners }} idle
            </span>
          </div>
        </div>

        <!-- Transporters -->
        <div class="bg-sky-500/5 border border-sky-500/20 rounded px-2 py-2">
          <div class="flex items-end justify-between">
            <div>
              <div class="text-[7px] uppercase tracking-[0.25em] text-white/25">Trans.</div>
              <div class="text-[14px] leading-none font-bold text-sky-300 tabular-nums">
                {{ lockedTransporters }}
              </div>
            </div>
            <div class="text-[10px] text-white/30 tabular-nums">/ {{ totalTransporters }}</div>
          </div>
          <!-- Utilization bar -->
          <div class="mt-2 h-1 rounded-full bg-white/6 overflow-hidden">
            <div
              class="h-full bg-sky-400 rounded-full"
              :style="{ width: transportUtilization + '%' }"
            />
          </div>
          <div class="flex items-center justify-between mt-2 text-[8px]">
            <span class="text-white/20">{{ transportersReturning }} return</span>
            <span
              :class="
                idleTransporters > 0 && asteroidGroups.length > 0
                  ? 'text-amber-300/80'
                  : 'text-white/20'
              "
            >
              {{ idleTransporters }} idle
            </span>
          </div>
        </div>

        <!-- Network Load -->
        <div
          class="border rounded px-2 py-1.5 flex flex-col gap-0.5"
          :class="
            transportLoad >= 100
              ? 'bg-rose-500/5 border-rose-500/20'
              : transportLoad >= 80
                ? 'bg-amber-500/5 border-amber-500/20'
                : 'bg-emerald-500/5 border-emerald-500/20'
          "
        >
          <span class="text-[7px] text-white/25 uppercase tracking-[0.25em]"> Network Load </span>

          <span
            class="text-[14px] font-bold tabular-nums"
            :class="
              transportLoad >= 100
                ? 'text-rose-300'
                : transportLoad >= 80
                  ? 'text-amber-300'
                  : 'text-emerald-300'
            "
          >
            {{ transportLoad }}%
          </span>

          <span class="text-[8px] text-white/20"> transporter saturation </span>
        </div>

        <!-- Recalls 24h -->
        <div
          class="border rounded px-2 py-1.5 flex flex-col gap-0.5"
          :class="
            recallTrips24h > 0 ? 'bg-amber-500/5 border-amber-500/20' : 'bg-white/3 border-white/6'
          "
        >
          <span class="text-[7px] text-white/25 uppercase tracking-[0.25em] leading-none">
            Recalls 24h
          </span>

          <span
            class="text-[13px] font-bold tabular-nums leading-tight"
            :class="
              recallTrips24h > 3
                ? 'text-rose-300'
                : recallTrips24h > 0
                  ? 'text-amber-300'
                  : 'text-emerald-300'
            "
          >
            {{ recallTrips24h }}
          </span>

          <span class="text-[8px] leading-none text-white/20">
            {{
              recallTrips24h > 0
                ? recallShips24h + ' ship' + (recallShips24h !== 1 ? 's' : '')
                : 'no self-recalls'
            }}
          </span>
        </div>
      </div>

      <!-- ── 2. Alerts ────────────────────────────────────────────────────────── -->
      <div v-if="alerts.length > 0" class="flex flex-col gap-1.5">
        <p class="text-[8px] text-white/25 uppercase tracking-[0.3em]">Alerts</p>
        <div class="flex flex-col gap-1">
          <div
            v-for="(alert, i) in alerts"
            :key="i"
            class="flex items-center gap-2 px-2.5 py-1.5 rounded text-[10px]"
            :class="
              alert.severity === 'critical'
                ? 'bg-rose-500/10 border border-rose-500/20 text-rose-300'
                : 'bg-amber-500/8 border border-amber-500/15 text-amber-300/80'
            "
          >
            <span>{{ alert.severity === 'critical' ? '⚠' : '▲' }}</span>
            <span>{{ alert.message }}</span>
          </div>
        </div>
      </div>

      <!-- ── 3. Operations Table (collapsible) ───────────────────────────────── -->
      <div class="flex flex-col gap-1.5">
        <button
          class="flex items-center gap-2 text-left w-full group"
          @click="tableExpanded = !tableExpanded"
        >
          <p
            class="text-[8px] text-white/25 uppercase tracking-[0.3em] group-hover:text-white/40 transition-colors"
          >
            Operations
          </p>
          <span class="text-[8px] text-white/20 group-hover:text-white/35 transition-colors">
            {{ tableExpanded ? '▲ collapse' : '▼ expand' }}
          </span>
          <span class="text-[8px] text-white/15 ml-auto">{{ asteroidGroups.length }} sites</span>
        </button>

        <div v-if="tableExpanded" class="rounded border border-white/6 overflow-hidden">
          <!-- Header -->
          <div
            class="grid text-[7px] text-white/20 uppercase tracking-[0.3em] px-2 py-1.5 bg-white/2 border-b border-white/5"
            style="grid-template-columns: 1fr 1fr 1.2fr 1.4fr 1fr 1fr 1fr 1fr"
          >
            <span>Asteroid</span>
            <span>Resource</span>
            <span class="text-right">Mining/h</span>
            <span class="text-right">Buffer</span>
            <span class="text-right">Fill ETA</span>
            <span class="text-right">Trans.</span>
            <span class="text-right">Stab.</span>
            <span class="text-right">Status</span>
          </div>

          <!-- Rows -->
          <div
            v-for="row in asteroidRows"
            :key="row.group.asteroidId"
            class="grid items-center px-2 py-1.5 border-b border-white/4 last:border-0 cursor-pointer transition-colors hover:bg-white/4"
            style="grid-template-columns: 1fr 1fr 1.2fr 1.4fr 1fr 1fr 1fr 1fr"
            @click="selectedAsteroidId = row.group.asteroidId"
          >
            <!-- Asteroid -->
            <div class="flex flex-col gap-0.5">
              <span class="text-[9px] text-white/50 tabular-nums font-mono leading-none">
                {{ shortId(row.group.asteroidId) }}
              </span>
              <span class="text-[7px] text-white/20 tabular-nums leading-none">
                {{
                  SIZE_LABELS[row.group.asteroidSize] ?? row.group.asteroidSize[0]!.toUpperCase()
                }}
              </span>
            </div>

            <!-- Resource -->
            <div class="flex items-center gap-1">
              <span
                class="w-1.5 h-1.5 rounded-full shrink-0"
                :style="{ backgroundColor: resourceColor(row.group.asteroidPrimaryResourceKey) }"
              />
              <span class="text-[8px] text-white/40 truncate">
                {{
                  row.group.asteroidPrimaryResourceKey
                    ? resourceName(row.group.asteroidPrimaryResourceKey).slice(0, 4)
                    : '–'
                }}
              </span>
            </div>

            <!-- Mining Rate -->
            <span
              class="text-[9px] tabular-nums font-semibold text-right"
              :style="{ color: resourceColor(row.group.asteroidPrimaryResourceKey) + 'cc' }"
            >
              {{ row.detail ? '+' + fmtRate(row.miningRate) : '…' }}
            </span>

            <!-- Buffer Fill -->
            <div class="flex flex-col items-end gap-0.5">
              <span class="text-[8px] tabular-nums text-white/40">
                <template v-if="row.recallThreshold > 0">
                  {{ Math.round(row.bufferFillPct) }}%
                </template>
                <template v-else>
                  {{ fmtRate(row.bufferTotal) }}
                </template>
              </span>
              <div class="w-full h-0.5 bg-white/8 rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full"
                  :class="
                    row.bufferFillPct >= 80
                      ? 'bg-rose-400'
                      : row.bufferFillPct >= 60
                        ? 'bg-amber-400'
                        : 'bg-white/20'
                  "
                  :style="{ width: (row.recallThreshold > 0 ? row.bufferFillPct : 0) + '%' }"
                />
              </div>
            </div>

            <!-- Fill ETA -->
            <span
              class="text-[8px] tabular-nums text-right"
              :class="
                row.fillEtaHours !== null && row.fillEtaHours < 1
                  ? 'text-rose-400'
                  : 'text-white/35'
              "
            >
              {{ fmtEta(row.fillEtaHours) }}
            </span>

            <!-- Transporters -->
            <span class="text-[8px] tabular-nums text-sky-300/60 text-right">
              {{ row.transporterCount > 0 ? '×' + row.transporterCount : '–' }}
            </span>

            <!-- Stability -->
            <span
              class="text-[8px] tabular-nums text-right"
              :style="{ color: stabilityColor(row.group.asteroidStability) }"
            >
              {{ (row.group.asteroidStability * 100).toFixed(0) }}%
            </span>

            <!-- Status -->
            <span
              class="text-[7px] uppercase tracking-wider text-right font-semibold"
              :class="
                row.status === 'critical'
                  ? 'text-rose-400'
                  : row.status === 'warning'
                    ? 'text-amber-400'
                    : 'text-green-400/60'
              "
            >
              {{ row.status }}
            </span>
          </div>

          <!-- Empty state -->
          <div v-if="asteroidGroups.length === 0" class="px-3 py-4 text-center">
            <p class="text-[9px] text-white/15 uppercase tracking-[0.4em]">No active operations</p>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Asteroid Detail Overlay ──────────────────────────────────────────── -->
    <div
      v-if="selectedAsteroidId"
      class="absolute inset-0 z-20 bg-black/70 flex items-center justify-center p-4"
      @click.self="selectedAsteroidId = null"
    >
      <div
        class="w-full max-w-2xl max-h-full overflow-auto rounded border border-white/10 bg-[#0a0c14]"
      >
        <AsteroidPanel
          :asteroid-id="selectedAsteroidId"
          :station-id="props.stationId"
          @close="selectedAsteroidId = null"
          @refresh="loadAll(true)"
        />
      </div>
    </div>
  </div>
</template>
