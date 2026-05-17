<script setup lang="ts">
import { ref, watch } from 'vue';
import { apiClient } from '../lib/api-client';
import type { AsteroidDetail } from '@orions-frontier/shared';

const props = defineProps<{
  asteroidId: string;
}>();

const emit = defineEmits<{ close: [] }>();

// ── Resource display maps ────────────────────────────────────────────────────
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

function resourceName(type: string) {
  return RESOURCE_NAMES[type] ?? type.toUpperCase();
}

function resourceColor(type: string) {
  return RESOURCE_CSS_COLORS[type] ?? '#888888';
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
  { immediate: true },
);

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatCoord(n: number) {
  return n.toFixed(1);
}

function richnessTier(r: number): string {
  if (r >= 80) return 'EXCEPTIONAL';
  if (r >= 60) return 'RICH';
  if (r >= 40) return 'MODERATE';
  if (r >= 20) return 'SPARSE';
  return 'TRACE';
}

function richnessTierColor(r: number): string {
  if (r >= 80) return 'text-amber-300';
  if (r >= 60) return 'text-cyan-300';
  if (r >= 40) return 'text-white/70';
  if (r >= 20) return 'text-white/45';
  return 'text-white/30';
}
</script>

<template>
  <div class="absolute bottom-0 left-0 w-full z-20 h-[200px] flex flex-col font-mono select-none">
    <!-- Panel background -->
    <div class="absolute inset-0 bg-[#060c1b]/97 backdrop-blur-xl border-t-2"
         :style="asteroid ? `border-color: ${resourceColor(asteroid.resourceType)}55` : 'border-color: #00c8ff40'" />
    <!-- Corner accents -->
    <div class="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-cyan-400/30 z-10" />
    <div class="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cyan-400/30 z-10" />

    <!-- Content -->
    <div class="relative z-20 flex flex-col h-full">

      <!-- ── Header ──────────────────────────────────────────────────────────── -->
      <div class="flex items-center justify-between px-5 h-10 border-b border-white/6 shrink-0">
        <div class="flex items-center gap-3">
          <!-- Resource color dot -->
          <span
            class="w-2 h-2 rounded-full ring-1 ring-white/10 shrink-0"
            :style="asteroid ? `background:${resourceColor(asteroid.resourceType)}` : 'background:#555'"
          />
          <span class="text-[9px] text-white/25 uppercase tracking-[0.35em]">Asteroid</span>
          <span class="text-sm font-semibold tracking-widest text-white/90">
            {{ asteroid ? resourceName(asteroid.resourceType).toUpperCase() : '—' }}
          </span>
          <span v-if="asteroid" class="text-[9px] text-white/20 tracking-widest">#{{ asteroid.id.slice(0, 6) }}</span>
        </div>
        <button
          @click="emit('close')"
          class="w-7 h-7 flex items-center justify-center rounded text-white/50 hover:text-white/80 hover:bg-white/5 transition text-[11px]"
        >✕</button>
      </div>

      <!-- ── Loading / Error ─────────────────────────────────────────────────── -->
      <div v-if="loading" class="flex-1 flex items-center justify-center">
        <span class="text-[9px] text-white/25 tracking-widest animate-pulse uppercase">Scanning…</span>
      </div>
      <div v-else-if="error" class="flex-1 flex items-center justify-center">
        <span class="text-[9px] text-red-400/60 tracking-wider">{{ error }}</span>
      </div>

      <!-- ── Stats body ──────────────────────────────────────────────────────── -->
      <div v-else-if="asteroid" class="flex-1 grid grid-cols-3 gap-px px-5 py-3">

        <!-- Column 1: Richness -->
        <div class="flex flex-col gap-2">
          <span class="text-[8px] text-white/20 uppercase tracking-[0.3em]">Richness</span>
          <!-- Bar -->
          <div class="h-1.5 rounded-full bg-white/6 overflow-hidden w-full max-w-20">
            <div
              class="h-full rounded-full transition-all duration-500"
              :style="`width:${asteroid.richness}%; background:${resourceColor(asteroid.resourceType)}`"
            />
          </div>
          <div class="flex items-baseline gap-1.5">
            <span class="text-lg font-semibold tabular-nums" :style="`color:${resourceColor(asteroid.resourceType)}`">
              {{ asteroid.richness }}
            </span>
            <span :class="['text-[9px] uppercase tracking-widest', richnessTierColor(asteroid.richness)]">
              {{ richnessTier(asteroid.richness) }}
            </span>
          </div>
        </div>

        <!-- Column 2: Location + Status -->
        <div class="flex flex-col gap-2.5">
          <span class="text-[8px] text-white/20 uppercase tracking-[0.3em]">Location</span>
          <div class="text-[10px] text-white/55 leading-relaxed">
            <div><span class="text-white/20">X</span> {{ formatCoord(asteroid.x) }}</div>
            <div><span class="text-white/20">Y</span> {{ formatCoord(asteroid.y) }}</div>
            <div class="mt-1">
              <span class="text-white/20">Chunk</span>
              <span class="text-white/40 ml-1">{{ asteroid.chunkX }}, {{ asteroid.chunkY }}</span>
            </div>
          </div>
        </div>

        <!-- Column 3: Mining Outlook -->
        <div class="flex flex-col gap-2.5">
          <span class="text-[8px] text-white/20 uppercase tracking-[0.3em]">Mining</span>
          <div class="text-[10px] leading-relaxed">
            <div class="flex justify-between">
              <span class="text-white/25">Miners</span>
              <span class="text-white/55 tabular-nums">{{ asteroid.activeMiningAssignments }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-white/25">Rate</span>
              <span class="text-white/55 tabular-nums">{{ asteroid.currentMiningRate }}/s</span>
            </div>
            <div class="flex justify-between mt-1">
              <span class="text-white/25">Est. Yield</span>
              <span class="text-white/55 tabular-nums">~{{ asteroid.estimatedYield }}</span>
            </div>
          </div>
        </div>

      </div>

      <!-- ── Footer: actions ─────────────────────────────────────────────────── -->
      <div class="flex items-center gap-2 px-5 pb-3 shrink-0">
        <button
          disabled
          class="px-3 h-6 rounded text-[9px] uppercase tracking-widest text-white/20 border border-white/[0.07] cursor-not-allowed"
        >Assign Miner</button>
        <button
          disabled
          class="px-3 h-6 rounded text-[9px] uppercase tracking-widest text-white/20 border border-white/[0.07] cursor-not-allowed"
        >Survey</button>
        <div class="ml-auto flex items-center gap-1.5" v-if="asteroid">
          <span class="text-[8px] text-white/15 uppercase tracking-widest">Stability</span>
          <span class="text-[9px] tabular-nums text-white/40">{{ asteroid.stability }}%</span>
          <span v-if="asteroid.isDepleted" class="text-[8px] uppercase tracking-widest text-red-400/70 ml-2">Depleted</span>
        </div>
      </div>

    </div>
  </div>
</template>
