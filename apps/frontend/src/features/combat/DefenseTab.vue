<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { getSpacecraft } from '@orions-frontier/game-config';
import type { CombatReport, StationDefenseUpgradeWithDefinition } from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../../shared/api/api-client';
import { wsClient } from '../../shared/api/ws-client';
import { formatCountdown } from '../../shared/lib/format';
import { live } from '../../shared/lib/live.js';
import LoadMoreButton from '../../shared/ui/LoadMoreButton.vue';
import { BuildSlots, UpgradeCard } from '../station/index.js';
import { useResearchStore } from '../research/index.js';
import { useCombatStore } from './store.js';

const { stationId } = defineProps<{ stationId: string }>();
const upgrades = ref<StationDefenseUpgradeWithDefinition[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const combat = useCombatStore();
const research = useResearchStore();

// The overview store keeps combat reports current; it refreshes them on transport ticks.
const relevantReports = computed(() =>
  combat.state.combats.filter(
    (report) => report.attackerStationId === stationId || report.defenderStationId === stationId
  )
);

const incomingAttacks = computed(() =>
  relevantReports.value.filter(
    (report) => report.defenderStationId === stationId && report.status === 'traveling'
  )
);

function arrivesIn(report: CombatReport): string {
  return formatCountdown(Date.parse(report.arrivesAt), live.now);
}

/** Signature Analysis reveals the incoming fleet to the defender; otherwise it stays unknown. */
function incomingComposition(report: CombatReport): string {
  const fleet = Object.entries(report.attackerFleet ?? {}).filter(([, amount]) => amount > 0);
  if (fleet.length === 0) return 'composition unknown';
  return fleet.map(([key, amount]) => `${amount}× ${getSpacecraft(key)?.name ?? key}`).join(', ');
}

function reportSummary(report: CombatReport): string {
  if (report.status === 'traveling') return `En route, arrives in ${arrivesIn(report)}`;
  if (report.winner === null) return 'Target already destroyed, fleet turned back';
  const sent = report.attackerAmount === null ? '' : `${report.attackerAmount} sent, `;
  const integrity = report.stationDestroyed
    ? ', station destroyed'
    : report.integrityDamage > 0
      ? `, integrity −${report.integrityDamage} to ${report.defenderIntegrity}`
      : '';
  return `${sent}${report.attackerLosses} attacker losses, ${report.defenderLosses} defender losses${integrity}`;
}

// Combat multiplies the upgrades' score by Shield Technology, so the shown score does too.
const defenseScore = computed(() =>
  Math.round(
    upgrades.value.reduce(
      (sum, upgrade) =>
        sum + upgrade.effects.reduce((effectSum, effect) => effectSum + effect.value, 0),
      0
    ) * research.modifiers.stationDefense
  )
);

async function load(): Promise<void> {
  try {
    const response = await apiClient.get<{ upgrades: StationDefenseUpgradeWithDefinition[] }>(
      `/stations/${stationId}/defense`
    );
    upgrades.value = response.upgrades;
    error.value = null;
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Defense data could not be loaded');
  } finally {
    loading.value = false;
  }
}

void load();
const unsubscribe = [
  wsClient.on('defense_upgrade_completed', () => void load()),
  // A finished building can start a queued defense upgrade.
  wsClient.on('building_upgrade_completed', () => void load()),
  wsClient.on('research_completed', () => void load()),
  wsClient.onReconnected(() => void load()),
];
onUnmounted(() => {
  for (const off of unsubscribe) off();
});
</script>

<template>
  <div class="flex flex-col gap-2.5 overflow-y-auto px-[18px] py-3.5 text-sm">
    <div class="ui-card flex-row items-center justify-between border-rose-400/15 bg-rose-500/5">
      <span class="ui-label text-rose-300/70">Defense score</span>
      <span class="ui-num text-[22px] font-semibold text-rose-200">{{ defenseScore }}</span>
    </div>
    <p v-if="error" class="ui-error">{{ error }}</p>

    <template v-if="incomingAttacks.length > 0">
      <h3 class="ui-label mt-2">Incoming attacks</h3>
      <div
        v-for="report in incomingAttacks"
        :key="report.id"
        class="flex justify-between gap-3 rounded-lg border border-[#6b2f2c] bg-[#2a1214] px-3 py-2.5 text-ui-red"
      >
        <span>Hostile fleet inbound, {{ incomingComposition(report) }}</span>
        <span class="ui-num font-semibold">{{ arrivesIn(report) }}</span>
      </div>
    </template>

    <h3 class="ui-label mt-2">Upgrades</h3>
    <BuildSlots :station-id="stationId" @changed="load" />
    <p v-if="loading" class="animate-pulse text-ui-muted">Loading defense…</p>
    <UpgradeCard
      v-for="upgrade in upgrades"
      :key="upgrade.definition.key"
      :station-id="stationId"
      :item="upgrade"
      @error="error = $event"
      @changed="load"
    >
      <!-- Defense upgrades only carry `defense_score` effects. -->
      <template #default="{ maxed }">
        <div class="flex items-baseline gap-2 text-[13px] text-ui-soft">
          <span>Defense score</span>
          <span class="ui-num text-rose-200">+{{ upgrade.effects[0]?.value ?? 0 }}</span>
          <template v-if="upgrade.nextLevelEffects?.[0] && !maxed">
            <span class="text-ui-dim">→</span>
            <span class="ui-num font-semibold text-ui-green"
              >+{{ upgrade.nextLevelEffects[0].value }}</span
            >
          </template>
        </div>
      </template>
    </UpgradeCard>

    <h3 class="ui-label mt-2">Combat reports</h3>
    <p v-if="!loading && relevantReports.length === 0" class="text-ui-soft">No combat recorded.</p>
    <article v-for="report in relevantReports" :key="report.id" class="ui-card gap-1">
      <div class="flex items-baseline justify-between gap-2">
        <span class="font-semibold text-ui-bright">
          {{ report.attackerStationId === stationId ? 'Attack' : 'Defense' }}
        </span>
        <span
          class="text-xs"
          :class="report.winner === 'attacker' ? 'text-ui-amber' : 'text-ui-green'"
        >
          {{ report.status === 'resolved' ? report.winner : report.status }}
        </span>
      </div>
      <span class="text-[13px] text-ui-soft">{{ reportSummary(report) }}</span>
    </article>
    <LoadMoreButton v-if="combat.hasOlderCombats()" :load="combat.loadOlderCombats" />
  </div>
</template>
