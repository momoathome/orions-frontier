<script setup lang="ts">
import type { AsteroidVein } from '@orions-frontier/shared';

defineProps<{ veins: AsteroidVein[] }>();

const RESOURCE_NAMES: Record<string, string> = {
  carbon: 'Carbon',
  titanium: 'Titanium',
  hydrogenium: 'Hydrogenium',
  kyber_crystal: 'Kyber Crystal',
  astatine: 'Astatine',
};

const RESOURCE_COLORS: Record<string, string> = {
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

function resourceName(key: string) {
  return RESOURCE_NAMES[key] ?? key.toUpperCase();
}
function resourceColor(key: string) {
  return RESOURCE_COLORS[key] ?? '#888888';
}
function purityColor(tier: string) {
  return PURITY_COLORS[tier] ?? '#888888';
}
function formatYield(y: number) {
  return y >= 10 ? y.toFixed(1) : y.toFixed(2);
}
</script>

<template>
  <div class="flex flex-col gap-2.5 min-w-0">
    <span class="text-[9px] text-white/20 uppercase tracking-[0.3em]">Resource Veins</span>
    <div
      v-for="vein in veins"
      :key="vein.id"
      class="flex items-start gap-2.5 pb-2.5 border-b border-white/5 last:border-0 last:pb-0"
    >
      <div
        class="w-[3px] self-stretch rounded-full mt-0.5 shrink-0"
        :style="`background:${resourceColor(vein.resourceKey)}`"
      />
      <div class="flex flex-col gap-0.5 min-w-0">
        <span class="text-[9px] text-white/25 uppercase tracking-widest">
          {{ VEIN_LABELS[vein.veinType] }}
        </span>
        <div class="flex items-baseline gap-2 flex-wrap">
          <span class="text-[12px] font-medium" :style="`color:${resourceColor(vein.resourceKey)}`">
            {{ resourceName(vein.resourceKey) }}
          </span>
          <span class="text-[9px] text-white/25 uppercase tracking-wider">cap</span>
          <span class="text-[10px] text-white/40 tabular-nums"
            >{{ formatYield(vein.yieldPerHour) }}/h</span
          >
        </div>
        <div class="flex items-center gap-1.5">
          <span
            class="text-[9px] uppercase tracking-widest font-semibold"
            :style="`color:${purityColor(vein.purityTier)}`"
            >{{ vein.purityTier }}</span
          >
          <span class="text-[9px] text-white/30 tabular-nums"
            >purity ×{{ vein.purity.toFixed(2) }}</span
          >
        </div>
      </div>
    </div>
    <div v-if="veins.length === 0" class="text-[10px] text-white/20">No veins detected</div>
  </div>
</template>
