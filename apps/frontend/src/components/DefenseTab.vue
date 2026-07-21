<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import type { CombatReport } from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../lib/api-client';

const props = defineProps<{ stationId: string }>();
const reports = ref<CombatReport[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const relevantReports = computed(() =>
  reports.value.filter(
    (report) =>
      report.attackerStationId === props.stationId || report.defenderStationId === props.stationId
  )
);

async function load(): Promise<void> {
  try {
    reports.value = await apiClient.get('/me/combats');
    error.value = null;
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Defense data could not be loaded');
  } finally {
    loading.value = false;
  }
}

void load();
const interval = setInterval(() => void load(), 10_000);
onUnmounted(() => clearInterval(interval));
</script>

<template>
  <div class="grid h-full grid-cols-[220px_1fr] overflow-hidden font-mono text-[10px]">
    <div class="border-r border-white/5 p-4">
      <p class="mb-3 uppercase tracking-[0.3em] text-rose-300/50">Station defense</p>
      <p class="text-white/25">Available spacecraft defend automatically.</p>
      <p class="mt-3 text-white/15">Further station defense systems will be managed here.</p>
    </div>
    <div class="overflow-y-auto p-4">
      <p class="mb-3 uppercase tracking-[0.3em] text-white/25">Combat reports</p>
      <p v-if="error" class="mb-3 text-rose-300/70">{{ error }}</p>
      <p v-if="loading" class="text-white/25">Loading…</p>
      <p v-else-if="relevantReports.length === 0" class="text-white/20">No combat recorded.</p>
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
