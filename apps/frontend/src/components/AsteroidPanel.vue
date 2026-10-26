<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { ApiError, apiClient } from '../lib/api-client';
import { wsClient } from '../lib/ws-client';
import { debounced } from '../lib/debounce';
import {
  estimateMiningCycle,
  getMiningTripPhase,
  getMiningTripPhaseEndsAt,
  type AsteroidDetail,
  type AsteroidVein,
  type MiningCycleEstimate,
} from '@orions-frontier/shared';
import AssignMinersForm from './AssignMinersForm.vue';
import RecallMinersForm, { type AssignmentGroup } from './RecallMinersForm.vue';
import { resourceColor, resourceName } from '../lib/mining-utils';

const { asteroidId, scannerBypass, stationId } = defineProps<{
  asteroidId: string;
  stationId: string | null;
  scannerBypass?: boolean;
}>();

const emit = defineEmits<{ close: []; refresh: [] }>();

const asteroid = ref<AsteroidDetail | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function loadAsteroid(id: string, showLoading = true) {
  if (showLoading) loading.value = true;
  error.value = null;
  if (showLoading) asteroid.value = null;
  try {
    const response = await apiClient.get<AsteroidDetail>(`/asteroids/${id}`, {
      params: { scannerBypass: scannerBypass },
    });
    asteroid.value = response;
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) {
      emit('close');
      return;
    }
    error.value = 'Unable to retrieve asteroid data.';
  } finally {
    if (showLoading) loading.value = false;
  }
}

watch(
  () => asteroidId,
  (id) => loadAsteroid(id),
  { immediate: true }
);

// Own actions and their realtime echo collapse into one reload.
const refreshAsteroid = debounced(() => loadAsteroid(asteroidId, false), 300);

const unsubMining = wsClient.on('mining_tick_completed', refreshAsteroid);
const unsubTrips = wsClient.on('transport_tick_completed', refreshAsteroid);
const now = ref(Date.now());
const clock = window.setInterval(() => (now.value = Date.now()), 1_000);
onUnmounted(() => {
  refreshAsteroid.cancel();
  unsubMining();
  unsubTrips();
  window.clearInterval(clock);
});

// Assigning and recalling happen inline in the operation column instead of in modals.
const action = ref<'assign' | 'recall' | null>(null);
watch(
  () => asteroidId,
  () => (action.value = null)
);

function toggleAction(next: 'assign' | 'recall') {
  action.value = action.value === next ? null : next;
}

function onActionDone() {
  action.value = null;
  emit('refresh');
  refreshAsteroid();
}

type Assignment = AsteroidDetail['assignments'][number];
interface OperationGroup {
  key: string;
  stationId: string;
  spacecraftKey: string;
  spacecraftName: string;
  assignments: Assignment[];
  totalAmount: number;
  activeAmount: number;
  recallRequestedAmount: number;
  isOwn: boolean;
}

const operationGroups = computed<OperationGroup[]>(() => {
  const groups = new Map<string, OperationGroup>();
  for (const assignment of asteroid.value?.assignments ?? []) {
    const key = `${assignment.stationId}:${assignment.spacecraftKey}`;
    const group = groups.get(key) ?? {
      key,
      stationId: assignment.stationId,
      spacecraftKey: assignment.spacecraftKey,
      spacecraftName: assignment.spacecraftName,
      assignments: [],
      totalAmount: 0,
      activeAmount: 0,
      recallRequestedAmount: 0,
      isOwn: assignment.stationId === stationId,
    };
    group.assignments.push(assignment);
    group.totalAmount += assignment.assignedAmount;
    group.activeAmount += activeAmount(assignment);
    group.recallRequestedAmount += assignment.recallRequestedAmount;
    groups.set(key, group);
  }
  return [...groups.values()];
});

const groupedAssignments = computed<AssignmentGroup[]>(() =>
  operationGroups.value.map((group) => ({
    stationId: group.stationId,
    spacecraftKey: group.spacecraftKey,
    spacecraftName: group.spacecraftName,
    ids: group.assignments.map((assignment) => assignment.id),
    totalAmount: group.totalAmount,
    isOwn: group.isOwn,
    recallRequestedAmount: group.recallRequestedAmount,
    members: group.assignments.map((assignment) => ({
      id: assignment.id,
      availableAmount: activeAmount(assignment),
    })),
  }))
);

const ownGroups = computed(() =>
  groupedAssignments.value.filter(
    (group) => group.isOwn && group.recallRequestedAmount < group.totalAmount
  )
);

const totalMiningPowerRaw = computed(
  () =>
    asteroid.value?.assignments.reduce(
      (sum, a) => sum + (a.assignedAmount - a.recallRequestedAmount) * a.spacecraftMiningRate,
      0
    ) ?? 0
);

const totalRemaining = computed(
  () => asteroid.value?.veins.reduce((sum, vein) => sum + vein.remainingAmount, 0) ?? 0
);
const totalInitial = computed(
  () => asteroid.value?.veins.reduce((sum, vein) => sum + vein.initialAmount, 0) ?? 0
);

function remainingPercent(remaining: number, initial: number): number {
  return initial > 0 ? Math.min(100, Math.round((remaining / initial) * 100)) : 100;
}

const activeMinerCount = computed(
  () =>
    asteroid.value?.assignments.reduce(
      (sum, assignment) => sum + assignment.assignedAmount - assignment.recallRequestedAmount,
      0
    ) ?? 0
);

function activeAmount(assignment: Assignment): number {
  return assignment.assignedAmount - assignment.recallRequestedAmount;
}

function flightHours(assignment: Assignment): number {
  const trip = assignment.activeTrip;
  if (!trip) return 0;
  return Math.max(0, (Date.parse(trip.arrivesAt) - Date.parse(trip.departedAt)) / 3_600_000);
}

function cycle(assignment: Assignment): MiningCycleEstimate | null {
  if (activeAmount(assignment) <= 0) return null;
  return estimateMiningCycle({
    oneWayTravelHours: flightHours(assignment),
    miningRate: assignment.spacecraftMiningRate,
    cargoCapacity: assignment.spacecraftCargo,
    minerCount: activeAmount(assignment),
    remainingAmount: totalRemaining.value,
  });
}

function deliveryPerHour(assignment: Assignment): number {
  return cycle(assignment)?.totalDeliveryPerHour ?? 0;
}

function referenceAssignment(group: OperationGroup): Assignment | undefined {
  return group.assignments.find((assignment) => assignment.activeTrip) ?? group.assignments[0];
}

function groupFlightHours(group: OperationGroup): number {
  const assignment = referenceAssignment(group);
  return assignment ? flightHours(assignment) : 0;
}

function groupMiningHours(group: OperationGroup): number {
  const assignment = referenceAssignment(group);
  return assignment ? (cycle(assignment)?.miningHours ?? 0) : 0;
}

function groupRoundTripHours(group: OperationGroup): number {
  const assignment = referenceAssignment(group);
  return assignment ? (cycle(assignment)?.roundTripHours ?? 0) : 0;
}

function groupLoad(group: OperationGroup): number {
  return referenceAssignment(group)?.spacecraftCargo ?? 0;
}

const totalDeliveryPerHour = computed(
  () => asteroid.value?.assignments.reduce((sum, item) => sum + deliveryPerHour(item), 0) ?? 0
);

const estimatedDepletionHours = computed(() =>
  totalDeliveryPerHour.value > 0 ? totalRemaining.value / totalDeliveryPerHour.value : 0
);

function phaseLabel(assignment: Assignment): string {
  const trip = assignment.activeTrip;
  if (!trip) return 'WAITING';
  return (
    getMiningTripPhase(
      {
        purpose: trip.purpose,
        departedAt: Date.parse(trip.departedAt),
        arrivesAt: Date.parse(trip.arrivesAt),
      },
      now.value
    )?.toUpperCase() ?? 'WAITING'
  );
}

function phaseDeadline(assignment: Assignment): number | null {
  const trip = assignment.activeTrip;
  if (!trip) return null;
  return getMiningTripPhaseEndsAt(
    {
      purpose: trip.purpose,
      departedAt: Date.parse(trip.departedAt),
      arrivesAt: Date.parse(trip.arrivesAt),
    },
    now.value
  );
}

function phaseDescription(assignment: Assignment): string {
  switch (phaseLabel(assignment)) {
    case 'OUTBOUND':
      return 'Asteroid arrival';
    case 'MINING':
      return 'Return begins';
    case 'RETURNING':
      return 'Station arrival';
    default:
      return 'Awaiting next trip';
  }
}

function phaseCount(group: OperationGroup, phase: string): number {
  return group.assignments.reduce(
    (sum, assignment) => sum + (phaseLabel(assignment) === phase ? activeAmount(assignment) : 0),
    0
  );
}

function formatDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

function formatCountdown(deadline: number | null): string {
  if (!deadline) return '—';
  const seconds = Math.max(0, Math.ceil((deadline - now.value) / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
    : `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatCargo(trip: NonNullable<Assignment['activeTrip']> | null): string {
  if (!trip?.cargoManifest) return '—';
  return Object.entries(trip.cargoManifest)
    .filter(([, amount]) => amount > 0)
    .map(([key, amount]) => `${amount} ${resourceName(key)}`)
    .join(' · ');
}

const nextDelivery = computed(() => {
  const returning = (asteroid.value?.assignments ?? [])
    .map((assignment) => assignment.activeTrip)
    .filter(
      (trip): trip is NonNullable<Assignment['activeTrip']> =>
        trip?.purpose === 'mining_return' && !!trip.cargoManifest
    )
    .sort((left, right) => Date.parse(left.arrivesAt) - Date.parse(right.arrivesAt));
  return returning[0] ?? null;
});

const nextEvent = computed(() => {
  const events = (asteroid.value?.assignments ?? []).flatMap((assignment) => {
    const deadline = phaseDeadline(assignment);
    return deadline && deadline > now.value
      ? [{ assignment, deadline, description: phaseDescription(assignment) }]
      : [];
  });
  return events.sort((left, right) => left.deadline - right.deadline)[0] ?? null;
});

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
    class="absolute bottom-0 left-0 w-full min-h-[260px] cursor-default z-20 flex flex-col font-mono select-none"
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
      <div class="flex items-center justify-between px-5 h-12 border-b border-white/8 shrink-0">
        <div class="flex items-center gap-3">
          <span
            class="w-2 h-2 rounded-full ring-1 ring-white/10 shrink-0"
            :style="
              primaryVein
                ? `background:${resourceColor(primaryVein.resourceKey)}`
                : 'background:#555'
            "
          />
          <span class="text-[10px] text-white/45 uppercase tracking-[0.2em]">Asteroid</span>
          <span class="text-[15px] font-semibold tracking-wider text-white/90">
            {{ primaryVein ? resourceName(primaryVein.resourceKey).toUpperCase() : '—' }}
          </span>
          <span v-if="asteroid" class="text-[10px] text-white/40 tracking-wider uppercase">
            {{ SIZE_LABELS[asteroid.size] ?? asteroid.size }}
          </span>
          <span v-if="asteroid" class="text-[10px] text-white/30 tracking-wider">
            #{{ asteroid.id.slice(0, 6) }}
          </span>
        </div>
        <div class="flex items-center gap-5">
          <div v-if="asteroid" class="flex items-baseline gap-2">
            <span class="text-[10px] text-white/40 uppercase tracking-[0.16em]">Reserve</span>
            <span class="text-[16px] font-semibold text-white/85 tabular-nums">
              {{ totalRemaining.toLocaleString('de-DE') }}
            </span>
            <span class="text-[11px] text-white/40 tabular-nums">
              / {{ totalInitial.toLocaleString('de-DE') }} ·
              {{ remainingPercent(totalRemaining, totalInitial) }}% left
            </span>
          </div>
          <button
            type="button"
            class="w-8 h-8 flex items-center justify-center rounded text-white/55 hover:text-white/90 hover:bg-white/6 transition text-[14px]"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- Loading / Error -->
      <div v-if="loading" class="flex-1 flex items-center justify-center">
        <span class="text-[11px] text-white/45 tracking-wider animate-pulse uppercase"
          >Scanning…</span
        >
      </div>
      <div v-else-if="error" class="flex-1 flex items-center justify-center">
        <span class="text-[11px] text-red-400/80 tracking-wide">{{ error }}</span>
      </div>

      <!-- Body -->
      <div
        v-else-if="asteroid"
        class="flex-1 grid gap-5 px-5 py-4 overflow-hidden grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"
      >
        <!-- Resources -->
        <div class="flex flex-col gap-3 min-w-0 overflow-y-auto pr-1">
          <span class="text-[10px] text-white/45 uppercase tracking-[0.18em]">Resources</span>
          <div v-if="asteroid.veins.length === 0" class="text-[12px] text-white/40">
            No veins detected
          </div>
          <div
            class="flex flex-1 flex-col"
            :class="asteroid.veins.length === 1 ? 'justify-center' : 'justify-start'"
          >
            <div
              v-for="vein in asteroid.veins"
              :key="vein.id"
              class="flex items-center gap-3 py-3 border-b border-white/7 last:border-0"
            >
              <div
                class="w-1 self-stretch rounded-full shrink-0"
                :style="`background:${resourceColor(vein.resourceKey)}`"
              />
              <div class="flex flex-col gap-1.5 min-w-0 flex-1">
                <div class="flex items-center justify-between gap-4 min-w-0">
                  <div class="flex items-baseline gap-3 min-w-0">
                    <span
                      class="text-[14px] font-medium"
                      :style="`color:${resourceColor(vein.resourceKey)}`"
                    >
                      {{ resourceName(vein.resourceKey) }}
                    </span>
                    <span
                      class="text-[10px] text-white/40 uppercase tracking-[0.14em] whitespace-nowrap"
                    >
                      {{ VEIN_TYPE_LABELS[vein.veinType] }}
                    </span>
                  </div>
                  <div class="flex items-baseline gap-2 shrink-0">
                    <span class="text-[17px] text-white/85 tabular-nums font-semibold">
                      {{ vein.remainingAmount.toLocaleString('de-DE') }}
                    </span>
                    <span class="text-[10px] text-white/40 uppercase tracking-wide">
                      / {{ vein.initialAmount.toLocaleString('de-DE') }}
                    </span>
                  </div>
                </div>
                <div
                  class="h-1 rounded-full bg-white/8 overflow-hidden"
                  role="meter"
                  :aria-valuenow="remainingPercent(vein.remainingAmount, vein.initialAmount)"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  :aria-label="`${resourceName(vein.resourceKey)} reserve left`"
                >
                  <div
                    class="h-full rounded-full transition-[width] duration-700"
                    :style="`width:${remainingPercent(vein.remainingAmount, vein.initialAmount)}%;background:${resourceColor(vein.resourceKey)}`"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Mining operation -->
        <div class="flex flex-col gap-3 border-l border-white/8 pl-5 overflow-y-auto">
          <AssignMinersForm
            v-if="action === 'assign' && stationId"
            :asteroid-id="asteroidId"
            :station-id="stationId"
            @cancel="action = null"
            @done="onActionDone"
          />
          <RecallMinersForm
            v-else-if="action === 'recall'"
            :own-groups="ownGroups"
            :asteroid-id="asteroidId"
            @cancel="action = null"
            @done="onActionDone"
          />
          <span v-else class="text-[10px] text-white/45 uppercase tracking-[0.18em]">
            Mining operation
          </span>

          <template v-if="!action && asteroid.operationsVisible && asteroid.assignments.length > 0">
            <div class="flex items-baseline justify-between gap-3 text-[11px]">
              <span class="text-white/55">
                {{ activeMinerCount }} {{ activeMinerCount === 1 ? 'miner' : 'miners' }} ·
                {{ totalMiningPowerRaw.toFixed(0) }}/h extraction
              </span>
              <span class="text-cyan-300/80 tabular-nums font-semibold">
                ~{{ totalDeliveryPerHour.toFixed(0) }}/h delivered
              </span>
            </div>

            <div class="flex flex-col gap-2">
              <div
                v-for="group in operationGroups"
                :key="group.key"
                class="rounded border border-white/8 bg-white/2.5 px-3 py-2"
              >
                <div class="flex items-center justify-between gap-3 mb-2">
                  <span class="text-[12px] text-white/75 font-medium">
                    {{ group.activeAmount }}× {{ group.spacecraftName }}
                    <span
                      v-if="group.recallRequestedAmount"
                      class="text-[10px] text-amber-300/70 font-normal"
                    >
                      · {{ group.recallRequestedAmount }} recalled
                    </span>
                  </span>
                  <div class="flex items-center justify-end gap-2 text-[10px] tabular-nums">
                    <span
                      v-if="phaseCount(group, 'OUTBOUND') > 0"
                      class="rounded-sm bg-sky-300/8 px-2 py-0.5 font-semibold tracking-wide text-sky-300/85"
                    >
                      {{ phaseCount(group, 'OUTBOUND') }} OUTBOUND
                    </span>
                    <span
                      v-if="phaseCount(group, 'MINING') > 0"
                      class="rounded-sm bg-amber-300/8 px-2 py-0.5 font-semibold tracking-wide text-amber-300/85"
                    >
                      {{ phaseCount(group, 'MINING') }} MINING
                    </span>
                    <span
                      v-if="phaseCount(group, 'RETURNING') > 0"
                      class="rounded-sm bg-orange-300/8 px-2 py-0.5 font-semibold tracking-wide text-orange-300/85"
                    >
                      {{ phaseCount(group, 'RETURNING') }} RETURNING
                    </span>
                    <span
                      v-if="phaseCount(group, 'WAITING') > 0"
                      class="font-semibold tracking-wide text-white/45"
                    >
                      {{ phaseCount(group, 'WAITING') }} WAITING
                    </span>
                  </div>
                </div>

                <div class="grid grid-cols-4 gap-4 text-[10px] tabular-nums">
                  <div class="flex flex-col gap-0.5">
                    <span class="text-white/35">Flight</span>
                    <span class="text-white/70">{{ formatDuration(groupFlightHours(group)) }}</span>
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <span class="text-white/35">Mining</span>
                    <span class="text-white/70">{{ formatDuration(groupMiningHours(group)) }}</span>
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <span class="text-white/35">Round trip</span>
                    <span class="text-white/70">{{
                      formatDuration(groupRoundTripHours(group))
                    }}</span>
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <span class="text-white/35">Load each</span>
                    <span class="text-white/70">{{ groupLoad(group) }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-3 gap-3 mt-auto">
              <div class="rounded border border-white/8 bg-white/2.5 px-3 py-2">
                <span class="block text-[10px] text-white/40 mb-1">Next event</span>
                <div v-if="nextEvent" class="flex items-baseline justify-between gap-3">
                  <span class="text-[11px] text-white/65">
                    {{ nextEvent.description }} · {{ nextEvent.assignment.spacecraftName }}
                  </span>
                  <span class="text-[12px] text-white/80 tabular-nums font-semibold">
                    {{ formatCountdown(nextEvent.deadline) }}
                  </span>
                </div>
                <span v-else class="text-[11px] text-white/40">Awaiting next trip</span>
              </div>
              <div class="rounded border border-orange-300/12 bg-orange-300/[0.035] px-3 py-2">
                <span class="block text-[10px] text-white/40 mb-1">Next delivery</span>
                <div v-if="nextDelivery" class="flex items-baseline justify-between gap-3">
                  <span class="text-[12px] text-orange-200/80">
                    {{ formatCargo(nextDelivery) }}
                  </span>
                  <span class="text-[12px] text-white/80 tabular-nums font-semibold">
                    {{ formatCountdown(Date.parse(nextDelivery.arrivesAt)) }}
                  </span>
                </div>
                <span v-else class="text-[11px] text-white/40">Cargo not loaded yet</span>
              </div>
              <div class="rounded border border-white/8 bg-white/2.5 px-3 py-2">
                <span class="block text-[10px] text-white/40 mb-1">Estimated depletion</span>
                <span class="text-[12px] text-amber-200/75 tabular-nums font-semibold">
                  {{ formatDuration(estimatedDepletionHours) }}
                </span>
              </div>
            </div>
          </template>

          <div
            v-else-if="!action"
            class="flex flex-1 flex-col items-center justify-center text-center px-8"
          >
            <span class="text-[11px] text-white/55 uppercase tracking-[0.14em]">
              No local mining telemetry
            </span>
            <p class="mt-2 max-w-sm text-[12px] leading-relaxed text-white/40">
              Assign miners to monitor flight times, deliveries and depletion for this asteroid.
            </p>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center gap-3 px-5 py-3 shrink-0 border-t border-white/7">
        <button
          v-if="stationId"
          type="button"
          class="px-4 h-8 rounded text-[11px] uppercase tracking-[0.12em] text-cyan-300 border border-cyan-400/45 hover:bg-cyan-400/12 hover:border-cyan-400/70 transition font-semibold"
          :class="action === 'assign' ? 'bg-cyan-400/12 border-cyan-400/70' : ''"
          :aria-pressed="action === 'assign'"
          @click="toggleAction('assign')"
        >
          ⊕ {{ ownGroups.length > 0 ? 'Assign More' : 'Assign Miner' }}
        </button>
        <button
          v-else
          type="button"
          disabled
          class="px-4 h-8 rounded text-[11px] uppercase tracking-[0.12em] text-white/30 border border-white/10 cursor-not-allowed"
        >
          ⊕ Assign Miner
        </button>
        <button
          v-if="ownGroups.length > 0"
          type="button"
          class="px-4 h-8 rounded text-[11px] uppercase tracking-[0.12em] text-red-300 border border-red-400/40 hover:bg-red-400/12 hover:border-red-400/65 transition font-semibold"
          :class="action === 'recall' ? 'bg-red-400/12 border-red-400/65' : ''"
          :aria-pressed="action === 'recall'"
          @click="toggleAction('recall')"
        >
          ↩ Recall
        </button>

        <!-- Location compact -->
        <div
          v-if="asteroid"
          class="ml-auto flex items-center gap-2 text-[10px] text-white/35 tabular-nums uppercase tracking-wide"
        >
          <span>X&nbsp;{{ formatCoord(asteroid.x) }}</span>
          <span class="text-white/10">·</span>
          <span>Y&nbsp;{{ formatCoord(asteroid.y) }}</span>
          <span class="text-white/10">·</span>
          <span class="text-white/15">{{ asteroid.chunkX }}:{{ asteroid.chunkY }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
