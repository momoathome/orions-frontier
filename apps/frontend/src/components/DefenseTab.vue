<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import type { CombatReport, StationDefenseUpgradeWithDefinition } from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../lib/api-client';

const { stationId } = defineProps<{ stationId: string }>();
const reports = ref<CombatReport[]>([]);
const upgrades = ref<StationDefenseUpgradeWithDefinition[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const upgrading = ref<string | null>(null);
const now = ref(Date.now());

const nowInterval = setInterval(() => {
  now.value = Date.now();
}, 1000);

const relevantReports = computed(() =>
  reports.value.filter(
    (report) => report.attackerStationId === stationId || report.defenderStationId === stationId
  )
);

const defenseScore = computed(() =>
  upgrades.value.reduce(
    (sum, upgrade) =>
      sum + upgrade.effects.reduce((effectSum, effect) => effectSum + effect.value, 0),
    0
  )
);

function defenseEffectValue(upgrade: StationDefenseUpgradeWithDefinition): number {
  // Verteidigungs-Upgrades haben laut Typ nur `defense_score`-Effekte.
  return upgrade.effects[0]?.value ?? 0;
}

function nextDefenseEffectValue(upgrade: StationDefenseUpgradeWithDefinition): number | null {
  return upgrade.nextLevelEffects?.[0]?.value ?? null;
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function upgradeTimeRemaining(upgrade: StationDefenseUpgradeWithDefinition): string | null {
  if (!upgrade.upgradeEndsAt) return null;
  const seconds = Math.ceil((new Date(upgrade.upgradeEndsAt).getTime() - now.value) / 1000);
  return seconds > 0 ? formatDuration(seconds) : null;
}

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
    await load();
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Defense upgrade failed');
  } finally {
    upgrading.value = null;
  }
}

void load();
const interval = setInterval(() => void load(), 10_000);
onUnmounted(() => {
  clearInterval(interval);
  clearInterval(nowInterval);
});
</script>

<template>
  <div class="grid h-full grid-cols-[220px_1fr] overflow-hidden font-mono text-[10px]">
    <div class="border-r border-white/5 p-4">
      <p class="mb-3 uppercase tracking-[0.3em] text-rose-300/50">Station defense</p>
      <div class="mb-4 rounded border border-rose-400/15 bg-rose-500/5 p-3">
        <p class="text-[9px] uppercase tracking-[0.25em] text-white/25">Defense Score</p>
        <p class="mt-1 text-2xl font-semibold tabular-nums text-rose-200">
          {{ defenseScore }}
        </p>
      </div>
      <div class="space-y-2">
        <div
          v-for="upgrade in upgrades"
          :key="upgrade.definition.key"
          class="flex items-center justify-between border-b border-white/5 pb-2"
        >
          <span class="text-white/45">{{ upgrade.definition.name }}</span>
          <span class="text-rose-200/80 tabular-nums">Lv.{{ upgrade.level }}</span>
        </div>
      </div>
    </div>
    <div class="overflow-y-auto p-4">
      <p class="mb-3 uppercase tracking-[0.3em] text-white/25">Defense upgrades</p>
      <p v-if="error" class="mb-3 text-rose-300/70">{{ error }}</p>
      <p v-if="loading" class="text-white/25">Loading…</p>
      <div v-else class="mb-5 grid grid-cols-2 gap-2">
        <div
          v-for="upgrade in upgrades"
          :key="upgrade.definition.key"
          class="rounded border border-white/7 p-3"
        >
          <div class="mb-2 flex items-start justify-between gap-3">
            <div>
              <p class="text-[11px] font-semibold tracking-wide text-white/70">
                {{ upgrade.definition.name }}
              </p>
              <p class="mt-1 text-white/25">{{ upgrade.definition.description }}</p>
            </div>
            <span class="text-rose-200/80 tabular-nums">Lv.{{ upgrade.level }}</span>
          </div>
          <div class="mb-2 flex items-center gap-2 text-[10px]">
            <span class="text-white/25">Score</span>
            <span class="text-rose-200 tabular-nums">+{{ defenseEffectValue(upgrade) }}</span>
            <template v-if="nextDefenseEffectValue(upgrade) !== null">
              <span class="text-white/20">→</span>
              <span class="text-green-300/80 tabular-nums">
                +{{ nextDefenseEffectValue(upgrade) }}
              </span>
            </template>
          </div>
          <div class="mb-3 flex flex-wrap gap-2">
            <span
              v-for="cost in upgrade.upgradeCosts"
              :key="cost.resourceKey"
              class="text-white/45 tabular-nums"
            >
              {{ cost.resourceKey }} {{ cost.amount.toLocaleString() }}
            </span>
          </div>
          <div
            v-if="upgrade.isUpgrading"
            class="mb-3 flex items-center justify-between border-t border-white/5 pt-2"
          >
            <span class="uppercase tracking-[0.18em] text-white/25">Ready in</span>
            <span class="tabular-nums text-amber-300">
              {{ upgradeTimeRemaining(upgrade) ?? 'Completing…' }}
            </span>
          </div>
          <div
            v-else-if="upgrade.upgradeDurationSeconds !== null"
            class="mb-3 flex items-center justify-between border-t border-white/5 pt-2"
          >
            <span class="uppercase tracking-[0.18em] text-white/25">Build time</span>
            <span class="tabular-nums text-white/50">
              {{ formatDuration(upgrade.upgradeDurationSeconds) }}
            </span>
          </div>
          <button
            type="button"
            class="rounded border px-3 py-1.5 text-[9px] uppercase tracking-[0.2em] transition"
            :disabled="
              upgrade.isUpgrading ||
              upgrade.level >= upgrade.definition.maxLevel ||
              Boolean(upgrading)
            "
            :class="
              upgrade.isUpgrading ||
              upgrade.level >= upgrade.definition.maxLevel ||
              Boolean(upgrading)
                ? 'border-amber-500/25 bg-amber-500/8 text-amber-400/50'
                : 'border-rose-400/35 bg-rose-500/8 text-rose-200 hover:bg-rose-500/16'
            "
            @click="startUpgrade(upgrade)"
          >
            <span v-if="upgrade.level >= upgrade.definition.maxLevel">Max Level</span>
            <span v-else-if="upgrade.isUpgrading">Upgrading…</span>
            <span v-else-if="upgrading === upgrade.definition.key">Starting…</span>
            <span v-else>Upgrade</span>
          </button>
        </div>
      </div>

      <p class="mb-3 uppercase tracking-[0.3em] text-white/25">Combat reports</p>
      <p v-if="!loading && relevantReports.length === 0" class="text-white/20">
        No combat recorded.
      </p>
      <div
        v-for="report in relevantReports"
        :key="report.id"
        class="mb-2 grid grid-cols-[110px_1fr_auto] gap-4 rounded border border-white/7 p-3"
      >
        <span class="uppercase text-white/45">
          {{ report.attackerStationId === stationId ? 'Attack' : 'Defense' }}
        </span>
        <span class="text-white/45">
          {{ report.attackerAmount }} sent · {{ report.attackerLosses }} attacker losses ·
          {{ report.defenderLosses }} defender losses
        </span>
        <span :class="report.winner === 'attacker' ? 'text-amber-300' : 'text-green-300'">
          {{ report.status === 'resolved' ? report.winner : report.status }}
        </span>
      </div>
    </div>
  </div>
</template>
