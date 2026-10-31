<script setup lang="ts">
import { computed } from 'vue';
import type { InfluenceBreakdown } from '@orions-frontier/shared';
import { useRankingStore } from './store.js';

const rankingStore = useRankingStore();
const ranking = computed(() => rankingStore.state.ranking);

// The own row is pinned below the list when the player is outside the top entries.
const meOutsideTop = computed(() => {
  const value = ranking.value;
  if (!value?.me) return null;
  return value.top.some((entry) => entry.userId === value.me?.userId) ? null : value.me;
});

const breakdownTitle = (influence: InfluenceBreakdown): string =>
  `Buildings ${influence.buildings}, Research ${influence.research}, Defense ${influence.defense}, Fleet ${influence.fleet}`;
</script>

<template>
  <div class="flex flex-col text-sm">
    <template v-if="ranking">
      <div class="mb-3 flex items-baseline justify-between text-ui-muted">
        <span class="text-xs uppercase tracking-[0.08em]">Server ranking by influence</span>
        <span v-if="ranking.me" class="tabular-nums">
          Your rank <span class="text-ui-cyan">#{{ ranking.me.rank }}</span> of
          {{ ranking.totalPlayers }}
        </span>
        <span v-else>Found a station to enter the ranking</span>
      </div>
      <table class="w-full border-collapse text-left">
        <thead class="text-left text-xs uppercase tracking-[0.08em] text-ui-dim">
          <tr>
            <th class="w-10 pb-1 font-normal">#</th>
            <th class="pb-1 font-normal">Commander</th>
            <th class="w-20 pb-1 text-right font-normal">Stations</th>
            <th class="w-20 pb-1 text-right font-normal">Influence</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in [...ranking.top, ...(meOutsideTop ? [meOutsideTop] : [])]"
            :key="entry.userId"
            class="border-t border-ui-line"
            :class="
              entry.userId === ranking.me?.userId ? 'bg-cyan-500/10 text-cyan-200' : 'text-ui-text'
            "
          >
            <td class="py-2 tabular-nums text-ui-muted">{{ entry.rank }}</td>
            <td class="py-2 text-left">
              {{ entry.username }}
              <span
                v-if="entry.ownerType === 'bot'"
                class="ml-1 text-xs uppercase tracking-[0.08em] text-emerald-300/60"
                >bot</span
              >
            </td>
            <td class="py-2 text-right tabular-nums">{{ entry.stationCount }}</td>
            <td class="py-2 text-right tabular-nums" :title="breakdownTitle(entry.influence)">
              {{ entry.influence.total }}
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
