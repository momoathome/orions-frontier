<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { ApiError, apiClient } from '../lib/api-client';
import { wsClient } from '../lib/ws-client';
import { debounced } from '../lib/debounce';
import {
  estimateAssignmentCycle,
  getMiningTripPhase,
  getMiningTripPhaseEndsAt,
  type AsteroidDetail,
  type AsteroidVein,
  type MiningCycleEstimate,
} from '@orions-frontier/shared';
import AssignMinersForm from './AssignMinersForm.vue';
import RecallMinersForm, { type AssignmentGroup } from './RecallMinersForm.vue';
import { resourceColor, resourceName } from '../lib/mining-utils';
import UiModal from './UiModal.vue';
import CostList from './CostList.vue';
import { resources } from '@orions-frontier/game-config';
import { useOverviewStore } from '../stores/overview.js';

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

const overview = useOverviewStore();
const idleMiners = computed(() => (stationId ? overview.stationFleet(stationId).idleMiners : 0));

// Assigning and recalling open as modals over the panel.
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
  stationId: string | null;
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
  return estimateAssignmentCycle(assignment, totalRemaining.value);
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

/** Width of one phase in the flight/mining/return bar, as share of the round trip. */
function phaseShare(hours: number, group: OperationGroup): string {
  return `${(hours / groupRoundTripHours(group)) * 100}%`;
}

function groupLoad(group: OperationGroup): number {
  return referenceAssignment(group)?.spacecraftCargo ?? 0;
}

const totalDeliveryPerHour = computed(
  () => asteroid.value?.assignments.reduce((sum, item) => sum + deliveryPerHour(item), 0) ?? 0
);

/** Each cargo is split by remaining vein amounts, so a vein's yield is its share of the total. */
function veinYield(vein: AsteroidVein): number {
  return totalRemaining.value > 0
    ? (totalDeliveryPerHour.value * vein.remainingAmount) / totalRemaining.value
    : 0;
}

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
const nextDeliveryCargo = computed(() =>
  Object.entries(nextDelivery.value?.cargoManifest ?? {})
    .filter(([, amount]) => amount > 0)
    .map(([resourceKey, amount]) => ({ resourceKey, amount }))
);

const nextEvent = computed(() => {
  const events = (asteroid.value?.assignments ?? []).flatMap((assignment) => {
    const deadline = phaseDeadline(assignment);
    const shownAsDelivery =
      phaseLabel(assignment) === 'RETURNING' &&
      assignment.activeTrip?.id === nextDelivery.value?.id;
    return deadline && deadline > now.value && !shownAsDelivery
      ? [{ assignment, deadline, description: phaseDescription(assignment) }]
      : [];
  });
  return events.sort((left, right) => left.deadline - right.deadline)[0] ?? null;
});

const SIZE_LABELS: Record<string, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  massive: 'Massive',
};

const VEIN_TYPE_LABELS: Record<string, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  trace: 'Trace',
};

const primaryVein = computed<AsteroidVein | undefined>(() =>
  asteroid.value?.veins.find((v) => v.veinType === 'primary')
);
const headerTitle = computed(() => {
  if (primaryVein.value) return resourceName(primaryVein.value.resourceKey);
  return asteroid.value?.scanned === false ? 'Unscanned' : 'Asteroid';
});

function formatYield(perHour: number): string {
  return perHour < 10 ? perHour.toFixed(1) : Math.round(perHour).toLocaleString('en-US');
}

function formatCoord(n: number) {
  return n.toFixed(1);
}

const PHASES = [
  { key: 'OUTBOUND', label: 'outbound', style: 'bg-[#0d2238] text-ui-blue' },
  { key: 'MINING', label: 'mining', style: 'bg-[#2a200b] text-ui-amber' },
  { key: 'RETURNING', label: 'returning', style: 'bg-[#2b170c] text-ui-orange' },
  { key: 'WAITING', label: 'waiting', style: 'bg-ui-line text-ui-muted' },
] as const;
</script>

<template>
  <aside
    class="flex h-full w-[400px] shrink-0 flex-col border-l border-ui-line bg-ui-panel text-left text-sm text-ui-text"
    aria-label="Asteroid details"
  >
    <div class="flex items-start justify-between gap-3 border-b border-ui-line px-[18px] py-4">
      <div class="flex min-w-0 flex-col gap-1">
        <span class="ui-label">
          Asteroid<template v-if="asteroid">
            ({{ asteroid.size ? (SIZE_LABELS[asteroid.size] ?? asteroid.size) : 'Unknown size' }})
          </template>
        </span>
        <h2 class="flex items-center gap-2 text-xl font-semibold text-ui-bright">
          <span
            class="h-3 w-3 shrink-0 rounded-full"
            :style="{ background: primaryVein ? resourceColor(primaryVein.resourceKey) : '#555' }"
          />
          {{ headerTitle }}
        </h2>
      </div>
      <button
        type="button"
        class="ui-btn ui-btn-icon"
        aria-label="Close panel"
        @click="emit('close')"
      >
        ✕
      </button>
    </div>

    <div v-if="loading" class="flex flex-1 items-center justify-center text-ui-muted">
      <span class="animate-pulse">Scanning…</span>
    </div>
    <div v-else-if="error" class="flex flex-1 items-center justify-center text-ui-red">
      {{ error }}
    </div>

    <div v-else-if="asteroid" class="flex flex-1 flex-col gap-5 overflow-y-auto px-[18px] py-4">
      <!-- Reserve -->
      <section class="flex flex-col gap-2">
        <h3 class="ui-label">Reserve</h3>
        <template v-if="asteroid.scanned">
          <div class="flex items-baseline justify-between gap-3">
            <span class="ui-num text-[22px] font-semibold text-ui-bright">
              {{ totalRemaining.toLocaleString('en-US') }}
              <span class="text-sm font-normal text-ui-dim"
                >/ {{ totalInitial.toLocaleString('en-US') }}</span
              >
            </span>
            <span class="text-[13px] text-ui-soft">
              {{ remainingPercent(totalRemaining, totalInitial) }}% left
            </span>
          </div>
          <div
            class="ui-bar"
            role="meter"
            :aria-valuenow="remainingPercent(totalRemaining, totalInitial)"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-label="Reserve left"
          >
            <div
              class="h-full rounded-full transition-[width] duration-700"
              :style="{
                width: `${remainingPercent(totalRemaining, totalInitial)}%`,
                background: primaryVein ? resourceColor(primaryVein.resourceKey) : '#5fd6e6',
              }"
            />
          </div>
          <span v-if="estimatedDepletionHours > 0" class="text-[13px] text-ui-soft">
            Depleted in
            <strong class="ui-num font-semibold text-ui-amber">{{
              formatDuration(estimatedDepletionHours)
            }}</strong>
            at the current rate
          </span>
          <ul v-if="asteroid.veins.length > 1" class="mt-1 flex flex-col gap-1.5">
            <li
              v-for="vein in asteroid.veins"
              :key="vein.id"
              class="flex items-center justify-between gap-3 text-[13px]"
            >
              <span class="flex min-w-0 flex-1 items-center gap-2">
                <img
                  :src="resources[vein.resourceKey].image"
                  alt=""
                  class="h-4 w-4 shrink-0 object-contain"
                />
                <span class="text-ui-text">{{ resourceName(vein.resourceKey) }}</span>
                <span class="text-xs text-ui-dim">{{ VEIN_TYPE_LABELS[vein.veinType] }}</span>
              </span>
              <span class="ui-num text-ui-soft">{{
                vein.remainingAmount.toLocaleString('en-US')
              }}</span>
              <span
                v-if="totalDeliveryPerHour > 0"
                class="ui-num w-16 text-right"
                :class="veinYield(vein) >= 1 ? 'text-ui-cyan' : 'text-ui-dim'"
                >~{{ formatYield(veinYield(vein)) }}/h</span
              >
            </li>
          </ul>
          <p v-if="asteroid.veins.length === 0" class="text-ui-soft">No veins detected.</p>
        </template>
        <p v-else class="text-ui-soft">
          Outside scanner range. Composition and reserve stay unknown until your miners return their
          first cargo, or until a scanner upgrade brings it into range.
        </p>
      </section>

      <template v-if="asteroid.operationsVisible && asteroid.assignments.length > 0">
        <div class="grid grid-cols-2 gap-2.5">
          <div class="ui-card gap-1">
            <span class="text-xs text-ui-muted">Next delivery</span>
            <template v-if="nextDelivery">
              <span class="ui-num text-lg font-semibold text-ui-bright">{{
                formatCountdown(Date.parse(nextDelivery.arrivesAt))
              }}</span>
              <CostList :costs="nextDeliveryCargo" aria-label="Cargo" />
            </template>
            <span v-else class="text-[13px] text-ui-soft">Cargo not loaded yet</span>
          </div>
          <div class="ui-card gap-1">
            <span class="text-xs text-ui-muted">Yield</span>
            <!-- Mixed asteroids break the yield down per vein in the reserve list. -->
            <span class="ui-num flex items-center gap-1.5 text-lg font-semibold text-ui-cyan">
              <img
                v-if="asteroid.veins.length === 1 && asteroid.veins[0]"
                :src="resources[asteroid.veins[0].resourceKey].image"
                :alt="resourceName(asteroid.veins[0].resourceKey)"
                class="h-5 w-5 object-contain"
              />~{{ formatYield(totalDeliveryPerHour) }}/h</span
            >
            <span class="text-xs text-ui-muted"
              >{{ totalMiningPowerRaw.toFixed(0) }}/h extraction</span
            >
          </div>
        </div>

        <section class="flex flex-col gap-2">
          <h3 class="ui-label">Assigned miners ({{ activeMinerCount }})</h3>
          <article v-for="group in operationGroups" :key="group.key" class="ui-card">
            <div class="flex items-baseline justify-between gap-2">
              <span class="font-semibold text-ui-bright">
                {{ group.activeAmount }}× {{ group.spacecraftName }}
              </span>
              <span v-if="!group.isOwn" class="text-xs text-ui-dim">other station</span>
              <span v-else-if="group.recallRequestedAmount" class="text-xs text-ui-amber">
                {{ group.recallRequestedAmount }} recalled
              </span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <template v-for="phase in PHASES" :key="phase.key">
                <span
                  v-if="phaseCount(group, phase.key) > 0"
                  class="ui-num rounded px-2 py-0.5 text-xs"
                  :class="phase.style"
                  >{{ phaseCount(group, phase.key) }} {{ phase.label }}</span
                >
              </template>
            </div>
            <div
              v-if="groupRoundTripHours(group) > 0"
              class="flex h-1.5 overflow-hidden rounded-full bg-ui-line"
              aria-hidden="true"
            >
              <span
                class="bg-ui-blue"
                :style="{ width: phaseShare(groupFlightHours(group), group) }"
              />
              <span
                class="bg-ui-amber"
                :style="{ width: phaseShare(groupMiningHours(group), group) }"
              />
              <span
                class="bg-ui-orange"
                :style="{ width: phaseShare(groupFlightHours(group), group) }"
              />
            </div>
            <dl class="grid grid-cols-4 gap-2 text-xs text-ui-muted">
              <div class="flex flex-col gap-0.5">
                <dt>Flight</dt>
                <dd class="ui-num text-[13px] text-ui-text">
                  {{ formatDuration(groupFlightHours(group)) }}
                </dd>
              </div>
              <div class="flex flex-col gap-0.5">
                <dt>Mining</dt>
                <dd class="ui-num text-[13px] text-ui-text">
                  {{ formatDuration(groupMiningHours(group)) }}
                </dd>
              </div>
              <div class="flex flex-col gap-0.5">
                <dt>Round trip</dt>
                <dd class="ui-num text-[13px] text-ui-text">
                  {{ formatDuration(groupRoundTripHours(group)) }}
                </dd>
              </div>
              <div class="flex flex-col gap-0.5">
                <dt>Load each</dt>
                <dd class="ui-num text-[13px] text-ui-text">{{ groupLoad(group) }}</dd>
              </div>
            </dl>
          </article>
          <p v-if="nextEvent" class="text-[13px] text-ui-soft">
            Next: {{ nextEvent.description }} ({{ nextEvent.assignment.spacecraftName }}) in
            <strong class="ui-num text-ui-bright">{{ formatCountdown(nextEvent.deadline) }}</strong>
          </p>
        </section>
      </template>

      <section
        v-else
        class="flex flex-col gap-1 rounded-lg border border-dashed border-ui-line-strong p-3.5"
      >
        <span class="font-semibold text-ui-bright">No miners here yet</span>
        <span class="text-[13px] text-ui-soft">
          Assign miners to see flight times, deliveries and depletion for this asteroid.
        </span>
      </section>

      <section
        v-if="idleMiners > 0 && asteroid.scanned && totalRemaining > 0"
        class="flex flex-col gap-1 rounded-lg border border-dashed border-[#2b8a99] p-3.5"
      >
        <span class="font-semibold text-ui-cyan">More output possible</span>
        <span class="text-[13px] text-ui-soft">
          {{ idleMiners }} {{ idleMiners === 1 ? 'miner is' : 'miners are' }} idle at
          {{ stationId ? overview.stationName(stationId) : 'your station' }}.
        </span>
      </section>

      <span class="ui-num mt-auto text-xs text-ui-dim">
        X {{ formatCoord(asteroid.x) }}, Y {{ formatCoord(asteroid.y) }}, chunk
        {{ asteroid.chunkX }}:{{ asteroid.chunkY }}
      </span>
    </div>

    <div class="flex gap-2 border-t border-ui-line px-[18px] py-4">
      <button
        type="button"
        class="ui-btn ui-btn-primary flex-1"
        :disabled="!stationId"
        @click="toggleAction('assign')"
      >
        {{ ownGroups.length > 0 ? 'Assign more miners' : 'Assign miners' }}
      </button>
      <button
        v-if="ownGroups.length > 0"
        type="button"
        class="ui-btn ui-btn-danger"
        @click="toggleAction('recall')"
      >
        Recall
      </button>
    </div>

    <UiModal
      v-if="action === 'assign' && stationId"
      :title="`Assign miners to ${headerTitle}`"
      eyebrow="Mining"
      @close="action = null"
    >
      <AssignMinersForm
        :asteroid-id="asteroidId"
        :station-id="stationId"
        @cancel="action = null"
        @done="onActionDone"
      />
    </UiModal>
    <UiModal
      v-if="action === 'recall'"
      :title="`Recall miners from ${headerTitle}`"
      eyebrow="Mining"
      @close="action = null"
    >
      <RecallMinersForm
        :own-groups="ownGroups"
        :asteroid-id="asteroidId"
        @cancel="action = null"
        @done="onActionDone"
      />
    </UiModal>
  </aside>
</template>
