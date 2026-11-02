<script setup lang="ts">
import { computed } from 'vue';
import { resources } from '@orions-frontier/game-config';
import { resourceKeys } from '@orions-frontier/shared';
import { useAuthStore } from '../auth/index.js';
import { useLogbookStore } from '../logbook/index.js';
import { useRankingStore } from '../ranking/index.js';
import { useResearchStore } from '../research/index.js';
import { useStationStore } from '../station/index.js';
import { formatAmount, formatCountdown } from '../../shared/lib/format.js';
import { live } from '../../shared/lib/live.js';
import { resourceColor } from '../../shared/lib/resources.js';

const { stationId } = defineProps<{ stationId: string }>();
const emit = defineEmits<{ logbook: []; ranking: [] }>();
const stationStore = useStationStore();
const logbook = useLogbookStore();
const rankingStore = useRankingStore();
const research = useResearchStore();

const summary = computed(() => stationStore.state.details[stationId]?.resources ?? null);
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
          rate: stationStore.state.details[stationId]?.income?.perHour[key] ?? 0,
          fill: Math.min(1, fill),
          barColor: fill >= 0.9 ? 'var(--color-ui-amber)' : resourceColor(key),
        };
      })
  );
});
const rank = computed(() => rankingStore.state.ranking?.me ?? null);
const runningResearch = computed(() => {
  const tech = research.running[0];
  return tech?.completesAt
    ? {
        name: tech.definition.name,
        countdown: formatCountdown(Date.parse(tech.completesAt), live.now),
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
      <div class="flex min-w-0 items-center gap-2">
        <span
          class="h-2 w-2 shrink-0 rounded-full"
          :class="live.online ? 'bg-ui-green' : 'bg-ui-red'"
          :title="live.online ? 'Online' : 'Offline'"
        />
        <span class="truncate text-[15px] font-semibold text-ui-bright">{{
          stationStore.stationName(stationId)
        }}</span>
        <span class="shrink-0 text-xs" :class="live.online ? 'sr-only' : 'text-ui-red'">{{
          live.online ? 'Online' : 'Offline'
        }}</span>
      </div>
    </div>

    <ul
      class="flex min-w-0 flex-1 items-center gap-6"
      :aria-label="`Stock at ${stationStore.stationName(stationId)}`"
    >
      <li
        v-for="entry in entries"
        :key="entry.key"
        class="flex min-w-0 max-w-[180px] flex-1 flex-col gap-1.5 py-2"
        :title="entry.name"
      >
        <div class="flex items-center gap-2">
          <img :src="entry.image" :alt="entry.name" class="h-5 w-5 shrink-0 object-contain" />
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
          <span class="ui-num text-xs whitespace-nowrap text-ui-dim"
            >/ {{ formatAmount(entry.capacity) }}</span
          >
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

    <nav class="flex shrink-0 items-center gap-3">
      <!-- Below 1440px the labels collapse to icons so five resources keep their room. -->
      <div class="ui-btn-group">
        <button
          type="button"
          class="ui-btn"
          :title="runningResearch ? `${runningResearch.name} in progress` : 'Research'"
          @click="research.openView()"
        >
          <span
            class="ui-mask-icon size-4 mask-[url(/assets/navigation/research.webp)]"
            aria-hidden="true"
          />
          <span class="sr-only min-[1440px]:not-sr-only">Research</span>
          <span v-if="runningResearch" class="ui-num text-xs text-ui-amber">{{
            runningResearch.countdown
          }}</span>
        </button>
        <button type="button" class="ui-btn" title="Logbook" @click="emit('logbook')">
          <span
            class="ui-mask-icon size-4 mask-[url(/assets/navigation/logbook.webp)]"
            aria-hidden="true"
          />
          <span class="sr-only min-[1440px]:not-sr-only">Logbook</span>
          <span
            v-if="logbook.unseenLogbook.length > 0"
            class="ui-num rounded-full bg-[#10333c] px-1.5 py-0.5 text-xs text-ui-cyan"
          >
            {{ logbook.unseenLogbook.length }}<span class="sr-only"> new</span>
          </span>
        </button>
        <button
          type="button"
          class="ui-btn"
          :title="
            rank ? `Rank ${rank.rank} of ${rankingStore.state.ranking?.totalPlayers}` : 'Ranking'
          "
          @click="emit('ranking')"
        >
          <span
            class="ui-mask-icon size-5 mask-[url(/assets/navigation/ranking.webp)]"
            aria-hidden="true"
          />
          <span class="sr-only min-[1440px]:not-sr-only">Ranking</span>
          <span v-if="rank" class="ui-num text-ui-bright">#{{ rank.rank }}</span>
        </button>
      </div>
      <!-- App.vue sends the player to the login once the token is cleared. -->
      <button
        type="button"
        class="ui-btn w-10 px-0"
        aria-label="Log out"
        title="Log out"
        @click="useAuthStore().logout()"
      >
        <svg
          class="size-4"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" />
          <path d="M10.5 11 13.5 8l-3-3" />
          <path d="M13.5 8h-7" />
        </svg>
      </button>
    </nav>
  </header>
</template>
