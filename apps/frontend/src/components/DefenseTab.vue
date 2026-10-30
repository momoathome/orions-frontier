<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { getSpacecraft } from '@orions-frontier/game-config';
import {
  getCostShortfall,
  type CombatReport,
  type StationDefenseUpgradeWithDefinition,
} from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../lib/api-client';
import { wsClient } from '../lib/ws-client';
import { formatBuildTime, formatCountdown, formatShortfall } from '../lib/format';
import { useOverviewStore } from '../stores/overview.js';
import ConfirmCancelButton from './ConfirmCancelButton.vue';
import CostList from './CostList.vue';
import RequirementChips from './RequirementChips.vue';

const { stationId } = defineProps<{ stationId: string }>();
const reports = ref<CombatReport[]>([]);
const upgrades = ref<StationDefenseUpgradeWithDefinition[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const upgrading = ref<string | null>(null);
const cancelling = ref<string | null>(null);
const overview = useOverviewStore();
const now = computed(() => overview.state.now);
const stock = computed(() => overview.state.details[stationId]?.resources ?? null);

const relevantReports = computed(() =>
  reports.value.filter(
    (report) => report.attackerStationId === stationId || report.defenderStationId === stationId
  )
);

const incomingAttacks = computed(() =>
  relevantReports.value.filter(
    (report) => report.defenderStationId === stationId && report.status === 'traveling'
  )
);

function arrivesIn(report: CombatReport): string {
  return formatCountdown(Date.parse(report.arrivesAt), now.value);
}

/** Signature Analysis reveals the incoming fleet to the defender; otherwise it stays unknown. */
function incomingComposition(report: CombatReport): string {
  const fleet = Object.entries(report.attackerFleet ?? {}).filter(([, amount]) => amount > 0);
  if (fleet.length === 0) return 'composition unknown';
  return fleet.map(([key, amount]) => `${amount}× ${getSpacecraft(key)?.name ?? key}`).join(', ');
}

function reportSummary(report: CombatReport): string {
  if (report.winner === null) return 'Target already destroyed, fleet turned back';
  const sent = report.attackerAmount === null ? '' : `${report.attackerAmount} sent, `;
  const integrity = report.stationDestroyed
    ? ', station destroyed'
    : report.integrityDamage > 0
      ? `, integrity −${report.integrityDamage} to ${report.defenderIntegrity}`
      : '';
  return `${sent}${report.attackerLosses} attacker losses, ${report.defenderLosses} defender losses${integrity}`;
}

const defenseScore = computed(() =>
  upgrades.value.reduce(
    (sum, upgrade) =>
      sum + upgrade.effects.reduce((effectSum, effect) => effectSum + effect.value, 0),
    0
  )
);

// Same card shape as BuildingsTab so both tabs read alike.
const cards = computed(() =>
  upgrades.value.map((upgrade) => {
    const shortfall = getCostShortfall(
      upgrade.upgradeCosts,
      stock.value?.resources ?? {},
      stock.value?.rates ?? {}
    );
    const maxed = upgrade.level >= upgrade.definition.maxLevel;
    const locked = upgrade.blockers.length > 0;
    const endsAt = upgrade.upgradeEndsAt ? Date.parse(upgrade.upgradeEndsAt) : null;
    const upgradingNow = upgrade.isUpgrading && endsAt !== null && endsAt > now.value;
    const affordable = !maxed && !locked && shortfall.missing.length === 0;
    const durationMs = (upgrade.upgradeDurationSeconds ?? 0) * 1_000;
    return {
      upgrade,
      maxed,
      locked,
      affordable,
      upgradingNow,
      accent: upgradingNow
        ? 'border-[#5a4317]'
        : affordable
          ? 'border-rose-400/35'
          : locked
            ? 'opacity-60'
            : '',
      endsAt,
      progress:
        endsAt && durationMs > 0
          ? Math.min(100, Math.max(0, 100 - ((endsAt - now.value) / durationMs) * 100))
          : 0,
      buildTime:
        upgrade.upgradeDurationSeconds === null
          ? null
          : formatBuildTime(upgrade.upgradeDurationSeconds),
      // Defense upgrades only carry `defense_score` effects.
      score: upgrade.effects[0]?.value ?? 0,
      nextScore: upgrade.nextLevelEffects?.[0]?.value ?? null,
      missing: formatShortfall(shortfall),
    };
  })
);

async function load(): Promise<void> {
  try {
    const [combatReports, defenseResponse] = await Promise.all([
      apiClient.get<CombatReport[]>('/me/combats'),
      apiClient.get<{ upgrades: StationDefenseUpgradeWithDefinition[] }>(
        `/stations/${stationId}/defense`
      ),
    ]);
    reports.value = combatReports;
    upgrades.value = defenseResponse.upgrades;
    scheduleNextArrival();
    error.value = null;
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Defense data could not be loaded');
  } finally {
    loading.value = false;
  }
}

async function startUpgrade(upgrade: StationDefenseUpgradeWithDefinition): Promise<void> {
  if (upgrading.value || upgrade.isUpgrading) return;
  upgrading.value = upgrade.definition.key;
  try {
    await apiClient.post(`/stations/${stationId}/defense/${upgrade.definition.key}/upgrade`);
    await Promise.all([load(), overview.refreshStation(stationId)]);
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Defense upgrade failed');
  } finally {
    upgrading.value = null;
  }
}

async function cancelUpgrade(upgrade: StationDefenseUpgradeWithDefinition): Promise<void> {
  cancelling.value = upgrade.definition.key;
  try {
    await apiClient.delete(`/stations/${stationId}/defense/${upgrade.definition.key}/upgrade`);
    await Promise.all([load(), overview.refreshStation(stationId)]);
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Defense upgrade could not be cancelled');
  } finally {
    cancelling.value = null;
  }
}

// The defender gets no event when a battle resolves, so reload once at the next arrival.
let arrivalTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleNextArrival() {
  clearTimeout(arrivalTimer);
  const next = Math.min(
    ...reports.value
      .filter((report) => report.status === 'traveling')
      .map((report) => Date.parse(report.arrivesAt))
  );
  if (Number.isFinite(next)) {
    arrivalTimer = setTimeout(() => void load(), Math.max(0, next - Date.now()) + 2_000);
  }
}

void load();
// Pushed events instead of a 10 s poll: attacks announce, upgrades and own missions complete.
const unsubscribe = [
  wsClient.on('incoming_attack', () => void load()),
  wsClient.on('defense_upgrade_completed', () => void load()),
  wsClient.on('world_mission_completed', () => void load()),
  wsClient.on('research_completed', () => void load()),
];
onUnmounted(() => {
  for (const off of unsubscribe) off();
  clearTimeout(arrivalTimer);
});
</script>

<template>
  <div class="flex flex-col gap-2.5 overflow-y-auto px-[18px] py-3.5 text-sm">
    <div class="ui-card flex-row items-center justify-between border-rose-400/15 bg-rose-500/5">
      <span class="ui-label text-rose-300/70">Defense score</span>
      <span class="ui-num text-[22px] font-semibold text-rose-200">{{ defenseScore }}</span>
    </div>
    <p v-if="error" class="rounded-md border border-[#6b2f2c] bg-[#2a1214] px-3 py-2 text-ui-red">
      {{ error }}
    </p>

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
    <p v-if="loading" class="animate-pulse text-ui-muted">Loading defense…</p>
    <article
      v-for="card in cards"
      :key="card.upgrade.definition.key"
      class="ui-card"
      :class="card.accent"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-baseline gap-2">
          <h4 class="text-base font-semibold text-ui-bright">
            {{ card.upgrade.definition.name }}
          </h4>
          <span class="ui-num text-[13px] text-ui-muted">Lv. {{ card.upgrade.level }}</span>
        </div>
        <span
          v-if="card.upgradingNow"
          class="rounded bg-[#2a200b] px-2 py-0.5 text-xs text-ui-amber"
          >Upgrading</span
        >
        <span v-else-if="card.maxed" class="rounded bg-ui-line px-2 py-0.5 text-xs text-ui-muted"
          >Max level</span
        >
        <span v-else-if="card.locked" class="rounded bg-ui-line px-2 py-0.5 text-xs text-ui-muted"
          >Locked</span
        >
        <span
          v-else-if="card.affordable"
          class="rounded bg-rose-500/10 px-2 py-0.5 text-xs text-rose-200"
          >Affordable</span
        >
        <span v-else class="rounded bg-[#141d2c] px-2 py-0.5 text-xs text-ui-muted">Saving</span>
      </div>

      <p class="text-[13px] text-ui-muted">{{ card.upgrade.definition.description }}</p>

      <div class="flex items-baseline gap-2 text-[13px] text-ui-soft">
        <span>Defense score</span>
        <span class="ui-num text-rose-200">+{{ card.score }}</span>
        <template v-if="card.nextScore !== null && !card.maxed">
          <span class="text-ui-dim">→</span>
          <span class="ui-num font-semibold text-ui-green">+{{ card.nextScore }}</span>
        </template>
      </div>

      <div v-if="card.upgradingNow && card.endsAt" class="flex flex-col gap-1.5">
        <div class="ui-bar">
          <div
            class="h-full rounded-full bg-ui-amber transition-[width] duration-1000 ease-linear"
            :style="{ width: `${card.progress}%` }"
          />
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-[13px] text-ui-soft">
            Lv. {{ card.upgrade.level + 1 }} done in
            <strong class="ui-num text-ui-amber">{{ formatCountdown(card.endsAt, now) }}</strong>
          </span>
          <ConfirmCancelButton
            :busy="cancelling === card.upgrade.definition.key"
            @confirm="cancelUpgrade(card.upgrade)"
          />
        </div>
      </div>

      <RequirementChips v-else-if="card.locked" :blockers="card.upgrade.blockers" />

      <template v-else-if="!card.maxed">
        <div class="flex items-center justify-between gap-3">
          <CostList
            :costs="card.upgrade.upgradeCosts"
            :stock="stock?.resources"
            :duration="card.buildTime"
          />
          <button
            type="button"
            class="ui-btn"
            :class="{
              'border-rose-400/35 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20':
                card.affordable,
            }"
            :disabled="!card.affordable || upgrading !== null"
            @click="startUpgrade(card.upgrade)"
          >
            {{ upgrading === card.upgrade.definition.key ? 'Starting…' : 'Upgrade' }}
          </button>
        </div>
        <span v-if="card.missing" class="text-xs text-ui-amber">{{ card.missing }}</span>
      </template>
    </article>

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
  </div>
</template>
