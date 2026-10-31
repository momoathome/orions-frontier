<script setup lang="ts">
import { resources } from '@orions-frontier/game-config';
import { isOneOf, resourceKeys } from '@orions-frontier/shared';
import { resourceName } from '../lib/resources';

// Without a stock every cost renders neutral; with one, unaffordable costs turn red.
const { costs, stock, duration } = defineProps<{
  costs: readonly { resourceKey: string; amount: number }[];
  stock?: Partial<Record<string, number>> | null;
  /** Preformatted build time, shown last with a clock. */
  duration?: string | null;
}>();

const image = (key: string) => (isOneOf(resourceKeys, key) ? resources[key].image : null);
const short = (cost: { resourceKey: string; amount: number }) =>
  stock ? (stock[cost.resourceKey] ?? 0) < cost.amount : false;
</script>

<template>
  <ul class="ui-num flex flex-wrap gap-x-3 gap-y-1.5 text-[13px]" aria-label="Cost">
    <li
      v-for="cost in costs"
      :key="cost.resourceKey"
      class="flex items-center gap-1"
      :class="short(cost) ? 'text-ui-red' : 'text-ui-text'"
      :title="resourceName(cost.resourceKey)"
    >
      <img
        v-if="image(cost.resourceKey)"
        :src="image(cost.resourceKey) ?? undefined"
        :alt="resourceName(cost.resourceKey)"
        class="h-4 w-4 object-contain"
      />
      <span v-else>{{ resourceName(cost.resourceKey) }}</span>
      {{ cost.amount.toLocaleString('en-US') }}
    </li>
    <li v-if="duration" class="flex items-center gap-1 text-ui-muted" title="Build time">
      <span aria-hidden="true">⏱</span>{{ duration }}
    </li>
  </ul>
</template>
