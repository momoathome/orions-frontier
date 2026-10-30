<script setup lang="ts">
import { computed } from 'vue';
import { resources } from '@orions-frontier/game-config';
import { resourceKeys } from '@orions-frontier/shared';
import { useOverviewStore } from '../stores/overview.js';
import { useResearchStore } from '../stores/research.js';
import { formatAmount, formatCountdown } from '../lib/format.js';
import { resourceColor } from '../lib/mining-utils.js';

const { stationId } = defineProps<{ stationId: string }>();
const emit = defineEmits<{ logbook: []; ranking: [] }>();
const overview = useOverviewStore();
const research = useResearchStore();

const summary = computed(() => overview.state.details[stationId]?.resources ?? null);
const entries = computed(() => {
  const value = summary.value;
  if (!value) return [];
  return (
    resourceKeys
      // Kyber and Astatine stay hidden until Spectral scans reveal them or the station holds some.
      .filter(
        (key) =>
          value.resources[key] !== undefined &&
          (research.modifiers.visibleResources.includes(key) || (value.resources[key] ?? 0) > 0)
      )
      .map((key) => {
        const amount = value.resources[key] ?? 0;
        const fill = value.storageCapacity > 0 ? amount / value.storageCapacity : 0;
        return {
          key,
          name: resources[key].name,
          image: resources[key].image,
          amount,
          capacity: value.storageCapacity,
          // Expected mining income, the same figure as the Logistics tab.
          rate: overview.state.details[stationId]?.income?.perHour[key] ?? 0,
          fill: Math.min(1, fill),
          barColor: fill >= 0.9 ? 'var(--color-ui-amber)' : resourceColor(key),
        };
      })
  );
});
const rank = computed(() => overview.state.ranking?.me ?? null);
const runningResearch = computed(() => {
  const tech = research.running[0];
  return tech?.completesAt
    ? {
        name: tech.definition.name,
        countdown: formatCountdown(Date.parse(tech.completesAt), overview.state.now),
      }
    : null;
});
</script>

<template>
  <header
    class="flex h-[72px] shrink-0 items-center gap-6 border-b border-ui-line bg-ui-panel px-5 text-left"
  >
    <!-- Stock belongs to one station; name it so a second station never reads as a total. -->
    <div class="flex w-[276px] shrink-0 flex-col gap-0.5">
      <span class="text-[11px] font-semibold uppercase tracking-[0.2em] text-ui-dim">
        Orion's Frontier
      </span>
      <span class="truncate text-[15px] font-semibold text-ui-bright">{{
        overview.stationName(stationId)
      }}</span>
    </div>

    <ul
      class="flex min-w-0 flex-1 items-center gap-6"
      :aria-label="`Stock at ${overview.stationName(stationId)}`"
    >
      <li
        v-for="entry in entries"
        :key="entry.key"
        class="flex min-w-0 flex-col gap-1.5 py-2"
        :title="entry.name"
      >
        <div class="flex items-center gap-2">
          <img :src="entry.image" :alt="entry.name" class="h-5 w-5 shrink-0 object-contain" />
          <span class="hidden truncate text-xs text-ui-muted 2xl:inline" aria-hidden="true">{{
            entry.name
          }}</span>
          <span
            v-if="entry.rate > 0"
            class="ui-num text-xs text-ui-green"
            title="Expected mining income"
            >+{{ formatAmount(Math.round(entry.rate)) }}/h</span
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
      <button type="button" class="ui-btn" @click="research.openView()">
        Research
        <template v-if="runningResearch">
          <span class="hidden max-w-[140px] truncate text-xs font-normal text-ui-soft xl:inline">{{
            runningResearch.name
          }}</span>
          <span
            class="ui-num text-xs text-ui-amber"
            :title="`${runningResearch.name} in progress`"
            >{{ runningResearch.countdown }}</span
          >
        </template>
      </button>
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
