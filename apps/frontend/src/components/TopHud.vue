<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { resources } from '@orions-frontier/game-config';
import { apiClient } from '../lib/api-client.js';
import { wsClient } from '../lib/ws-client.js';
import type { ResourceKey, UserResourceSummary } from '@orions-frontier/shared';
import { ALL_RESOURCES } from '../lib/spacecraft-utils';

type ResourceEntry = {
  key: ResourceKey;
  name: string;
  image: string;
  amount: number;
  ratePerHour: number;
  effectiveRatePerHour: number;
};

const resourceEntries = ref<ResourceEntry[]>([]);
const isOnline = ref(true);

let pollInterval: ReturnType<typeof setInterval> | null = null;
// Debounce timer: collapses rapid bursts of WS events (e.g. 10 simultaneous
// trip arrivals with concurrency=10) into a single fetch 300 ms after the last.
let fetchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFetch() {
  if (fetchDebounceTimer) clearTimeout(fetchDebounceTimer);
  fetchDebounceTimer = setTimeout(() => {
    fetchDebounceTimer = null;
    fetchResources();
  }, 1000);
}

function applyResourceSummary(summary: UserResourceSummary) {
  resourceEntries.value = ALL_RESOURCES
    .filter((key) => summary.resources[key] !== undefined)
    .map((key) => {
      const def = resources[key as ResourceKey];
      return {
        key: key as ResourceKey,
        name: def.name,
        image: def.image,
        amount: summary.resources[key] as number,
        ratePerHour: summary.rates[key] ?? 0,
        effectiveRatePerHour: summary.effectiveRates?.[key] ?? 0,
      };
    });
}

async function fetchResources() {
  try {
    const { data } = await apiClient.get<{ success: true; data: UserResourceSummary }>(
      '/me/resources'
    );
    applyResourceSummary(data.data);
    isOnline.value = true;
  } catch {
    isOnline.value = false;
  }
}

// Instant update when resources are deducted (building upgrade / spacecraft build)
const unsubscribeResources = wsClient.on('resources_updated', (payload) => {
  const p = payload as { resources?: UserResourceSummary['resources'] };
  if (p?.resources) {
    // Merge amounts only — rates remain until next full fetch
    resourceEntries.value = resourceEntries.value.map((e) => ({
      ...e,
      amount: p.resources![e.key] ?? e.amount,
    }));
  }
});

// Refetch rates after every mining tick
const unsubscribeTick = wsClient.on('mining_tick_completed', () => {
  scheduleFetch();
});

// Refetch after transport tick (effective rates + resource amounts change on delivery)
const unsubscribeTransport = wsClient.on('transport_tick_completed', () => {
  scheduleFetch();
});

onMounted(() => {
  fetchResources();
  // Slow poll as fallback for any passive changes not covered by WS
});

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval);
  if (fetchDebounceTimer) clearTimeout(fetchDebounceTimer);
  unsubscribeResources();
  unsubscribeTick();
  unsubscribeTransport();
});

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function fmtRate(n: number): string {
  if (n >= 1_000) return '+' + (n / 1_000).toFixed(1) + 'k';
  return '+' + Math.round(n).toString();
}
</script>

<template>
  <div
    class="absolute top-0 left-0 right-0 z-10 cursor-default flex items-center justify-between px-5 h-9 bg-[#050a14]/90 border-b border-cyan-500/10 font-mono text-[11px]"
  >
    <!-- Resources -->
    <div class="flex items-center gap-1">
      <template v-for="(entry, i) in resourceEntries" :key="entry.key">
        <div class="h-3 w-px bg-white/10" v-if="i > 0" />
        <div class="flex items-center gap-1.5">
          <img
            :src="entry.image"
            :alt="entry.name"
            class="w-3.5 h-3.5 object-contain"
            loading="lazy"
          />
          <span class="text-white/25 uppercase tracking-widest text-[9px]">{{ entry.name }}</span>
          <span class="text-white/80 tabular-nums">{{ fmt(entry.amount) }}</span>
          <span
            v-if="entry.ratePerHour > 0"
            class="text-cyan-400/50 tabular-nums text-[9px]"
          >{{ fmtRate(entry.ratePerHour) }}/h</span>
          <!-- Effective delivery rate — shown only when it differs from theoretical -->
          <span
            v-if="entry.effectiveRatePerHour > 0 && Math.abs(entry.effectiveRatePerHour - entry.ratePerHour) > 1"
            class="text-amber-400/60 tabular-nums text-[9px]"
            :title="`Delivered last hour: ${Math.round(entry.effectiveRatePerHour)}/h (theoretical: ${Math.round(entry.ratePerHour)}/h)`"
          >↓{{ fmtRate(entry.effectiveRatePerHour) }}</span>
        </div>
      </template>

      <!-- Skeleton while loading -->
      <template v-if="resourceEntries.length === 0">
        <div
          v-for="n in 5"
          :key="n"
          class="flex items-center gap-1.5"
        >
          <div class="h-3 w-px bg-white/10" v-if="n > 1" />
          <div class="w-3.5 h-3.5 rounded bg-white/5 animate-pulse" />
          <div class="w-12 h-2 rounded bg-white/5 animate-pulse" />
        </div>
      </template>
    </div>

    <div class="tracking-[0.5em] text-white/10 uppercase text-[9px]">ORION'S FRONTIER</div>

    <div class="flex items-center gap-4">
      <span
        class="flex items-center gap-1.5 text-[9px] uppercase tracking-widest"
        :class="isOnline ? 'text-green-400/60' : 'text-red-400/60'"
      >
        <span
          class="w-1.5 h-1.5 rounded-full"
          :class="isOnline ? 'bg-green-400 animate-pulse' : 'bg-red-400'"
        />
        {{ isOnline ? 'Online' : 'Offline' }}
      </span>
      <div class="h-3 w-px bg-white/10" />
      <span class="text-white/20 text-[9px]">3 players nearby</span>
      <div class="h-3 w-px bg-white/10" />
      <span class="text-amber-400/60 text-[9px]">⚠ Scanner active</span>
    </div>
  </div>
</template>
