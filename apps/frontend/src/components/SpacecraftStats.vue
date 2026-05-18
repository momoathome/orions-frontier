<script setup lang="ts">
import type { StationSpacecraftWithDefinition } from '@orions-frontier/shared';
import { ALL_RESOURCES, roleTheme, formatBuildTime } from '../lib/spacecraft-utils';

const props = defineProps<{
  ship: StationSpacecraftWithDefinition;
}>();

function costFor(resourceKey: string): number {
  return props.ship.definition.costs.find((c) => c.resourceKey === resourceKey)?.amount ?? 0;
}
</script>

<template>
  <div class="flex gap-12">
    <!-- Stats -->
    <div class="flex flex-col gap-1 w-[180px] shrink-0">
      <span class="text-[9px] text-white/20 uppercase tracking-widest mb-0.5">Stats</span>
      <div class="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <div
          v-for="stat in [
            { label: 'Attack', value: ship.definition.attack },
            { label: 'Defence', value: ship.definition.defense },
            { label: 'Speed', value: ship.definition.speed },
            { label: 'Cargo', value: ship.definition.cargo },
            { label: 'Mining', value: ship.definition.miningRate },
          ]"
          :key="stat.label"
          class="flex items-center justify-between h-5 pr-1"
        >
          <span class="text-[9px] text-white/25">{{ stat.label }}</span>
          <span
            class="text-[11px] tabular-nums font-medium"
            :class="stat.value > 0 ? roleTheme(ship.definition.role).statValue : 'text-white/15'"
            >{{ stat.value }}</span
          >
        </div>
      </div>
    </div>

    <!-- Cost / unit -->
    <div class="flex flex-col gap-1">
      <span class="text-[9px] text-white/20 uppercase tracking-widest mb-0.5">Costs</span>
      <div class="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <div v-for="res in ALL_RESOURCES" :key="res" class="flex items-center gap-1.5 h-5">
          <img
            :src="`/assets/resources/${res}.png`"
            :alt="res"
            class="w-3.5 h-3.5 object-contain shrink-0"
            :class="costFor(res) > 0 ? 'opacity-80' : 'opacity-15'"
          />
          <span
            class="text-[10px] tabular-nums font-medium"
            :class="costFor(res) > 0 ? 'text-white/65' : 'text-white/15'"
            >{{ costFor(res) > 0 ? costFor(res).toLocaleString() : '—' }}</span
          >
        </div>
        <!-- Build time -->
        <div class="flex items-center gap-1.5 h-5">
          <span class="text-[12px] text-white/25 shrink-0 leading-none">⏱</span>
          <span class="text-[10px] text-white/50 tabular-nums">{{
            formatBuildTime(ship.definition.buildTime)
          }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
