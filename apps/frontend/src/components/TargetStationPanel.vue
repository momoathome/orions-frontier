<script setup lang="ts">
import { computed } from 'vue';
import type { VisibleStation } from '@orions-frontier/shared';

const props = defineProps<{
  station: VisibleStation;
  origin: { x: number; y: number } | null;
}>();

defineEmits<{ close: [] }>();

const distance = computed(() =>
  props.origin
    ? Math.hypot(props.station.x - props.origin.x, props.station.y - props.origin.y)
    : null
);
</script>

<template>
  <div
    class="absolute bottom-0 left-0 z-20 flex min-h-48 w-full cursor-default flex-col border-t-2 border-amber-400/35 bg-[#060c1b]/97 font-mono backdrop-blur-xl"
  >
    <div class="flex h-11 shrink-0 items-center justify-between border-b border-white/7 px-5">
      <div class="flex items-center gap-3">
        <span class="text-[9px] uppercase tracking-[0.35em] text-amber-300/45">Target station</span>
        <span class="text-sm font-semibold tracking-widest text-white/90">{{ station.name }}</span>
        <span class="text-[9px] uppercase tracking-widest text-white/25">
          {{ station.ownerType }}
        </span>
      </div>
      <button
        class="flex h-7 w-7 items-center justify-center rounded text-[11px] text-white/50 transition hover:bg-white/5 hover:text-white/80"
        @click="$emit('close')"
      >
        ✕
      </button>
    </div>

    <div class="grid flex-1 grid-cols-2 gap-8 px-5 py-4">
      <div class="flex flex-col gap-2 text-[10px]">
        <span class="text-[9px] uppercase tracking-[0.3em] text-white/20">Public data</span>
        <div class="flex justify-between border-b border-white/5 pb-1">
          <span class="text-white/30">Coordinates</span>
          <span class="tabular-nums text-white/65">{{ station.x }} / {{ station.y }}</span>
        </div>
        <div v-if="distance !== null" class="flex justify-between border-b border-white/5 pb-1">
          <span class="text-white/30">Distance</span>
          <span class="tabular-nums text-white/65">{{ distance.toFixed(0) }}</span>
        </div>
      </div>

      <div class="flex flex-col gap-2 border-l border-white/5 pl-5">
        <span class="text-[9px] uppercase tracking-[0.3em] text-white/20">Actions</span>
        <button
          disabled
          class="h-7 cursor-not-allowed rounded border border-red-400/15 text-[9px] uppercase tracking-widest text-red-300/30"
        >
          Attack — not available yet
        </button>
      </div>
    </div>
  </div>
</template>
