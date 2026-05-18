<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { resources } from '@orions-frontier/game-config';
import { apiClient } from '../lib/api-client.js';
import type { ResourceKey } from '@orions-frontier/shared';

type ResourceEntry = {
  key: ResourceKey;
  name: string;
  image: string;
  amount: number;
};

const resourceEntries = ref<ResourceEntry[]>([]);
const isOnline = ref(true);

let pollInterval: ReturnType<typeof setInterval> | null = null;

async function fetchResources() {
  try {
    const { data } = await apiClient.get<{ success: true; data: Record<ResourceKey, number> }>(
      '/me/resources'
    );
    resourceEntries.value = Object.entries(data.data).map(([key, amount]) => {
      const def = resources[key as ResourceKey];
      return {
        key: key as ResourceKey,
        name: def.name,
        image: def.image,
        amount: amount as number,
      };
    });
    isOnline.value = true;
  } catch {
    isOnline.value = false;
  }
}

onMounted(() => {
  fetchResources();
  pollInterval = setInterval(fetchResources, 30_000);
});

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval);
});

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}
</script>

<template>
  <div
    class="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-5 h-9 bg-[#050a14]/90 border-b border-cyan-500/10 font-mono text-[11px]"
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
