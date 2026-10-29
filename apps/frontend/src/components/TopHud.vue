<script setup lang="ts">
import { computed } from 'vue';
import { resources } from '@orions-frontier/game-config';
import { resourceKeys } from '@orions-frontier/shared';
import { useOverviewStore } from '../stores/overview.js';
import { formatAmount } from '../lib/format.js';
import { resourceColor } from '../lib/mining-utils.js';

const { stationId } = defineProps<{ stationId: string }>();
const emit = defineEmits<{ logbook: []; ranking: [] }>();
const overview = useOverviewStore();

const summary = computed(() => overview.state.details[stationId]?.resources ?? null);
const entries = computed(() => {
  const value = summary.value;
  if (!value) return [];
  return resourceKeys
    .filter((key) => value.resources[key] !== undefined)
    .map((key) => {
      const amount = value.resources[key] ?? 0;
      const fill = value.storageCapacity > 0 ? amount / value.storageCapacity : 0;
      return {
        key,
        name: resources[key].name,
        image: resources[key].image,
        amount,
        capacity: value.storageCapacity,
        rate: value.rates[key] ?? 0,
        fill: Math.min(1, fill),
        barColor: fill >= 0.9 ? 'var(--color-ui-amber)' : resourceColor(key),
      };
    });
});
const rank = computed(() => overview.state.ranking?.me ?? null);
</script>

<template>
  <header
    class="flex h-[72px] shrink-0 items-center gap-6 border-b border-ui-line bg-ui-panel px-5 text-left"
  >
    <div class="w-[276px] shrink-0">
      <span class="text-[13px] font-semibold uppercase tracking-[0.2em] text-ui-muted">
        Orion's Frontier
      </span>
    </div>

    <ul class="flex min-w-0 flex-1 items-center gap-6" aria-label="Station resources">
      <li v-for="entry in entries" :key="entry.key" class="flex min-w-0 flex-col gap-1.5 py-2">
        <div class="flex items-center gap-2">
          <img :src="entry.image" alt="" class="h-5 w-5 shrink-0 object-contain" />
          <span class="text-xs text-ui-muted">{{ entry.name }}</span>
          <span v-if="entry.rate > 0" class="ui-num text-xs text-ui-green"
            >+{{ formatAmount(entry.rate) }}/h</span
          >
        </div>
        <div class="flex items-center gap-2">
          <span class="ui-num text-base font-semibold text-ui-bright">{{
            formatAmount(entry.amount)
          }}</span>
          <span class="ui-num text-xs text-ui-dim">/ {{ formatAmount(entry.capacity) }}</span>
        </div>
        <div class="h-[3px] w-full overflow-hidden rounded-full bg-ui-line">
          <div
            class="h-full rounded-full"
            :style="{ width: `${entry.fill * 100}%`, background: entry.barColor }"
          />
        </div>
      </li>
      <li v-if="entries.length === 0" class="text-sm text-ui-dim">Loading resources…</li>
    </ul>

    <nav class="flex shrink-0 items-center gap-2">
      <button type="button" class="ui-btn" @click="emit('logbook')">
        Logbook
        <span
          v-if="overview.unseenLogbook.length > 0"
          class="ui-num rounded-full bg-[#10333c] px-2 py-0.5 text-xs text-ui-cyan"
        >
          {{ overview.unseenLogbook.length }} new
        </span>
      </button>
      <button type="button" class="ui-btn" @click="emit('ranking')">
        Ranking
        <span v-if="rank" class="ui-num text-ui-bright">
          #{{ rank.rank
          }}<span class="text-ui-dim"> / {{ overview.state.ranking?.totalPlayers }}</span>
        </span>
      </button>
      <span
        class="ml-2 flex items-center gap-1.5 text-xs"
        :class="overview.state.online ? 'text-ui-green' : 'text-ui-red'"
      >
        <span
          class="h-2 w-2 rounded-full"
          :class="overview.state.online ? 'bg-ui-green' : 'bg-ui-red'"
        />
        {{ overview.state.online ? 'Online' : 'Offline' }}
      </span>
    </nav>
  </header>
</template>
