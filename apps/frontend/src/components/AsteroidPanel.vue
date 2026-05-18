<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { apiClient } from '../lib/api-client';
import type { AsteroidDetail, AsteroidVein } from '@orions-frontier/shared';

const props = defineProps<{
  asteroidId: string;
}>();

const emit = defineEmits<{ close: [] }>();

// ── Resource / vein display maps ─────────────────────────────────────────────

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

const PURITY_COLORS: Record<string, string> = {
  impure: '#ff4444',
  normal: '#aaaaaa',
  rich: '#44ddaa',
  pure: '#00ccff',
  pristine: '#ffdd00',
};

const VEIN_LABELS: Record<string, string> = {
  primary: 'PRIMARY',
  secondary: 'SECONDARY',
  trace: 'TRACE',
};

const SIZE_LABELS: Record<string, string> = {
  small: 'SMALL',
  medium: 'MEDIUM',
  large: 'LARGE',
  massive: 'MASSIVE',
};

function resourceName(key: string) {
  return RESOURCE_NAMES[key] ?? key.toUpperCase();
}
function resourceColor(key: string) {
  return RESOURCE_CSS_COLORS[key] ?? '#888888';
}
function purityColor(tier: string) {
  return PURITY_COLORS[tier] ?? '#888888';
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
  { immediate: true }
);

// ── Derived ──────────────────────────────────────────────────────────────────

const primaryVein = computed<AsteroidVein | undefined>(() =>
  asteroid.value?.veins.find((v) => v.veinType === 'primary')
);

const panelAccentColor = computed(() =>
  primaryVein.value ? resourceColor(primaryVein.value.resourceKey) : '#00c8ff'
);

function stabilityColor(s: number) {
  if (s >= 0.8) return '#44ddaa';
  if (s >= 0.5) return '#ffdd00';
  return '#ff5533';
}

function formatYield(y: number) {
  return y >= 10 ? y.toFixed(1) : y.toFixed(2);
}

function formatCoord(n: number) {
  return n.toFixed(1);
}

function veinTotalYield(vein: AsteroidVein) {
  return formatYield(vein.yieldPerHour);
}
</script>

<template>
  <div
    class="absolute bottom-0 left-0 w-full z-20 flex flex-col font-mono select-none"
    style="min-height: 220px"
  >
    <!-- Panel background -->
    <div
      class="absolute inset-0 bg-[#060c1b]/97 backdrop-blur-xl border-t-2"
      :style="`border-color:${panelAccentColor}55`"
    />

    <!-- Corner accents -->
    <div class="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-cyan-400/30 z-10" />
    <div class="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cyan-400/30 z-10" />

    <!-- Content -->
    <div class="relative z-20 flex flex-col h-full">
      <!-- ── Header ──────────────────────────────────────────────────────────── -->
      <div class="flex items-center justify-between px-5 h-10 border-b border-white/6 shrink-0">
        <div class="flex items-center gap-3">
          <span
            class="w-2 h-2 rounded-full ring-1 ring-white/10 shrink-0"
            :style="
              primaryVein
                ? `background:${resourceColor(primaryVein.resourceKey)}`
                : 'background:#555'
            "
          />
          <span class="text-[9px] text-white/25 uppercase tracking-[0.35em]">Asteroid</span>
          <span class="text-sm font-semibold tracking-widest text-white/90">
            {{ primaryVein ? resourceName(primaryVein.resourceKey).toUpperCase() : '—' }}
          </span>
          <span v-if="asteroid" class="text-[9px] text-white/20 tracking-widest uppercase">
            {{ SIZE_LABELS[asteroid.size] ?? asteroid.size }}
          </span>
          <span v-if="asteroid" class="text-[9px] text-white/20 tracking-widest"
            >#{{ asteroid.id.slice(0, 6) }}</span
          >
        </div>
        <button
          @click="emit('close')"
          class="w-7 h-7 flex items-center justify-center rounded text-white/50 hover:text-white/80 hover:bg-white/5 transition text-[11px]"
        >
          ✕
        </button>
      </div>

      <!-- ── Loading / Error ─────────────────────────────────────────────────── -->
      <div v-if="loading" class="flex-1 flex items-center justify-center">
        <span class="text-[9px] text-white/25 tracking-widest animate-pulse uppercase"
          >Scanning…</span
        >
      </div>
      <div v-else-if="error" class="flex-1 flex items-center justify-center">
        <span class="text-[9px] text-red-400/60 tracking-wider">{{ error }}</span>
      </div>

      <!-- ── Body ───────────────────────────────────────────────────────────── -->
      <div
        v-else-if="asteroid"
        class="flex-1 grid grid-cols-[1.6fr_1fr_1fr_1fr] gap-6 px-5 py-3 overflow-hidden"
      >
        <!-- Column 1: Veins -->
        <div class="flex flex-col gap-2.5 min-w-0">
          <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Resource Veins</span>
          <div
            v-for="vein in asteroid.veins"
            :key="vein.id"
            class="flex items-start gap-2.5 pb-2.5 border-b border-white/5 last:border-0 last:pb-0"
          >
            <!-- Resource color stripe -->
            <div
              class="w-[3px] self-stretch rounded-full mt-0.5 shrink-0"
              :style="`background:${resourceColor(vein.resourceKey)}`"
            />
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="text-[9px] text-white/25 uppercase tracking-widest">{{
                VEIN_LABELS[vein.veinType]
              }}</span>
              <div class="flex items-baseline gap-2 flex-wrap">
                <span
                  class="text-[12px] font-medium"
                  :style="`color:${resourceColor(vein.resourceKey)}`"
                >
                  {{ resourceName(vein.resourceKey) }}
                </span>
                <span class="text-[10px] text-white/40 tabular-nums"
                  >{{ veinTotalYield(vein) }}/h</span
                >
              </div>
              <div class="flex items-center gap-1.5">
                <span
                  class="text-[9px] uppercase tracking-widest font-semibold"
                  :style="`color:${purityColor(vein.purityTier)}`"
                  >{{ vein.purityTier }}</span
                >
                <span class="text-[9px] text-white/30 tabular-nums"
                  >×{{ vein.purity.toFixed(2) }}</span
                >
              </div>
            </div>
          </div>
          <div v-if="asteroid.veins.length === 0" class="text-[10px] text-white/20">
            No veins detected
          </div>
        </div>

        <!-- Column 2: Stability -->
        <div class="flex flex-col gap-2 border-l border-white/5 pl-5">
          <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Stability</span>
          <span
            class="text-3xl font-semibold tabular-nums leading-none mt-1"
            :style="`color:${stabilityColor(asteroid.stability)}`"
            >{{ (asteroid.stability * 100).toFixed(0) }}%</span
          >
          <div class="h-1 rounded-full bg-white/6 overflow-hidden mt-1">
            <div
              class="h-full rounded-full transition-all duration-700"
              :style="`width:${(asteroid.stability * 100).toFixed(0)}%; background:${stabilityColor(asteroid.stability)}`"
            />
          </div>
          <!-- Mining counts below stability -->
          <div class="flex flex-col gap-1 mt-3">
            <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Mining</span>
            <div class="flex justify-between text-[10px] mt-0.5">
              <span class="text-white/30">Miners</span>
              <span class="text-white/60 tabular-nums">{{ asteroid.activeMiningAssignments }}</span>
            </div>
            <div class="flex justify-between text-[10px]">
              <span class="text-white/30">Buffer</span>
              <span class="text-white/60 tabular-nums">
                {{
                  asteroid.storage.length > 0
                    ? asteroid.storage.reduce((s, r) => s + r.amount, 0).toFixed(0)
                    : '0'
                }}
              </span>
            </div>
          </div>
        </div>

        <!-- Column 3: Buffer breakdown -->
        <div class="flex flex-col gap-2 border-l border-white/5 pl-5">
          <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Buffer</span>
          <div class="flex flex-col gap-1.5 mt-1">
            <div
              v-for="s in asteroid.storage"
              :key="s.resourceKey"
              class="flex items-center justify-between text-[10px]"
            >
              <span :style="`color:${resourceColor(s.resourceKey)}`">
                {{ resourceName(s.resourceKey) }}
              </span>
              <span class="text-white/50 tabular-nums">{{ s.amount.toFixed(1) }}</span>
            </div>
            <div v-if="asteroid.storage.length === 0" class="text-[10px] text-white/20">Empty</div>
          </div>
        </div>

        <!-- Column 4: Location -->
        <div class="flex flex-col gap-2 border-l border-white/5 pl-5">
          <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Location</span>
          <div class="flex flex-col gap-1 mt-1">
            <div class="flex justify-between text-[10px]">
              <span class="text-white/25">X</span>
              <span class="text-white/60 tabular-nums">{{ formatCoord(asteroid.x) }}</span>
            </div>
            <div class="flex justify-between text-[10px]">
              <span class="text-white/25">Y</span>
              <span class="text-white/60 tabular-nums">{{ formatCoord(asteroid.y) }}</span>
            </div>
            <div class="flex justify-between text-[10px] mt-1">
              <span class="text-white/25">Chunk X</span>
              <span class="text-white/50 tabular-nums">{{ asteroid.chunkX }}</span>
            </div>
            <div class="flex justify-between text-[10px]">
              <span class="text-white/25">Chunk Y</span>
              <span class="text-white/50 tabular-nums">{{ asteroid.chunkY }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Footer ─────────────────────────────────────────────────────────── -->
      <div class="flex items-center gap-2 px-5 pb-3 shrink-0">
        <button
          disabled
          class="px-3 h-6 rounded text-[9px] uppercase tracking-widest text-white/20 border border-white/[0.07] cursor-not-allowed"
        >
          Assign Miner
        </button>
        <button
          disabled
          class="px-3 h-6 rounded text-[9px] uppercase tracking-widest text-white/20 border border-white/[0.07] cursor-not-allowed"
        >
          Recall
        </button>
        <div v-if="asteroid" class="ml-auto text-[8px] text-white/15 uppercase tracking-widest">
          Scanner lv.{{ asteroid.hiddenLevel }}
        </div>
      </div>
    </div>
  </div>
</template>
