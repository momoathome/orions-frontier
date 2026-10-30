<script setup lang="ts">
import { computed } from 'vue';
import { useOverviewStore } from '../stores/overview.js';

const { stationId } = defineProps<{ stationId: string }>();
const overview = useOverviewStore();
const slots = computed(() => overview.state.details[stationId]?.buildSlots ?? null);
const full = computed(() => slots.value !== null && slots.value.used >= slots.value.total);
</script>

<template>
  <!-- Building and defense upgrades share these slots; Parallel Construction adds more. -->
  <div v-if="slots" class="flex flex-col gap-1">
    <div class="flex items-center justify-between gap-3">
      <span class="ui-label">Build slots</span>
      <span class="flex items-center gap-2">
        <span class="flex gap-1" aria-hidden="true">
          <span
            v-for="slot in slots.total"
            :key="slot"
            class="h-2.5 w-4 rounded-sm border"
            :class="
              slot <= slots.used
                ? 'border-ui-amber bg-ui-amber/70'
                : 'border-ui-line-strong bg-transparent'
            "
          />
        </span>
        <span class="ui-num text-[13px]" :class="full ? 'text-ui-amber' : 'text-ui-soft'"
          >{{ slots.used }} / {{ slots.total }} in use</span
        >
      </span>
    </div>
    <span v-if="full" class="text-xs text-ui-muted"
      >All slots busy. Wait for an upgrade or research Parallel Construction for more.</span
    >
  </div>
</template>
