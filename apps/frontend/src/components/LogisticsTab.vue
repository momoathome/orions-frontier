<script setup lang="ts">
import { computed, ref } from 'vue';
import { resources } from '@orions-frontier/game-config';
import { resourceKeys } from '@orions-frontier/shared';
import { formatAmount, formatCountdown, formatWait } from '../lib/format';
import { resourceColor, resourceName } from '../lib/mining-utils';
import { useOverviewStore } from '../stores/overview.js';
import AsteroidPanel from './AsteroidPanel.vue';
import CostList from './CostList.vue';

const { stationId } = defineProps<{ stationId: string }>();
const overview = useOverviewStore();
const selectedAsteroidId = ref<string | null>(null);

const now = computed(() => overview.state.now);
const detail = computed(() => overview.state.details[stationId] ?? null);
const income = computed(() => detail.value?.income ?? null);
const idleMiners = computed(() => overview.stationFleet(stationId).idleMiners);
const FULL_SOON_HOURS = 6;

// One row per resource the station stores or earns, in the header's order.
const rows = computed(() => {
  const summary = detail.value?.resources;
  if (!summary || !income.value) return [];
  const { perHour, inTransit } = income.value;
  return resourceKeys
    .filter((key) => summary.resources[key] !== undefined || (perHour[key] ?? 0) > 0)
    .map((key) => {
      const stock = summary.resources[key] ?? 0;
      const rate = perHour[key] ?? 0;
      const free = summary.storageCapacity - stock;
      const hoursToFull = rate > 0 && free > 0 ? free / rate : null;
      return {
        key,
        name: resources[key].name,
        image: resources[key].image,
        rate,
        stock,
        capacity: summary.storageCapacity,
        fill: summary.storageCapacity > 0 ? Math.min(1, stock / summary.storageCapacity) : 0,
        inTransit: inTransit[key] ?? 0,
        full: free <= 0,
        hoursToFull,
        fullSoon: hoursToFull !== null && hoursToFull < FULL_SOON_HOURS,
      };
    });
});

const arrivals = computed(() =>
  (income.value?.arrivals ?? []).filter((arrival) => arrival.arrivesAt > now.value).slice(0, 5)
);
const sources = computed(() => income.value?.sources ?? []);
const workingMiners = computed(() => sources.value.reduce((sum, source) => sum + source.miners, 0));

const sourceName = (key: string | null) => (key ? resourceName(key) : 'Unknown composition');
const shortId = (id: string) => `#${id.slice(0, 6)}`;
const formatRate = (perHour: number) =>
  perHour < 10 ? perHour.toFixed(1) : Math.round(perHour).toLocaleString('en-US');
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden text-sm">
    <div v-if="income" class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-[18px] py-4">
      <!-- What the station earns, and how long its storage keeps up. -->
      <section class="flex flex-col gap-2" aria-label="Income">
        <h3 class="ui-label">Expected income</h3>
        <ul class="flex flex-col gap-3">
          <li v-for="row in rows" :key="row.key" class="flex flex-col gap-1.5">
            <div class="flex items-center gap-2">
              <img :src="row.image" alt="" class="h-5 w-5 shrink-0 object-contain" />
              <span class="flex-1 text-ui-text">{{ row.name }}</span>
              <span
                class="ui-num font-semibold"
                :class="row.rate > 0 ? 'text-ui-cyan' : 'text-ui-dim'"
              >
                {{ row.rate > 0 ? `+${formatRate(row.rate)}/h` : '—' }}
              </span>
            </div>
            <div class="ui-bar">
              <div
                class="h-full rounded-full"
                :style="{
                  width: `${row.fill * 100}%`,
                  background:
                    row.full || row.fullSoon ? 'var(--color-ui-amber)' : resourceColor(row.key),
                }"
              />
            </div>
            <div class="flex items-baseline justify-between gap-2 text-xs">
              <span class="ui-num text-ui-muted">
                {{ formatAmount(row.stock) }} / {{ formatAmount(row.capacity) }}
                <span v-if="row.inTransit > 0" class="text-ui-orange">
                  (+{{ formatAmount(row.inTransit) }} en route)</span
                >
              </span>
              <span v-if="row.full" class="font-semibold text-ui-red">Storage full</span>
              <span
                v-else-if="row.hoursToFull !== null"
                :class="row.fullSoon ? 'text-ui-amber' : 'text-ui-dim'"
              >
                Full in {{ formatWait(row.hoursToFull) }}
              </span>
            </div>
          </li>
        </ul>
        <p v-if="income.unknownPerHour > 0" class="text-xs text-ui-muted">
          Plus ~{{ formatRate(income.unknownPerHour) }}/h from asteroids of unknown composition.
        </p>
      </section>

      <!-- The live part: cargo on its way home. -->
      <section class="flex flex-col gap-2" aria-label="Arriving cargo">
        <h3 class="ui-label">Arriving</h3>
        <ol v-if="arrivals.length > 0" class="flex flex-col gap-2">
          <li
            v-for="arrival in arrivals"
            :key="arrival.tripId"
            class="grid grid-cols-[4.5rem_1fr] items-center gap-3 rounded-md border border-ui-line bg-ui-card px-3 py-2"
          >
            <span class="ui-num text-base font-semibold text-ui-bright">
              {{ formatCountdown(arrival.arrivesAt, now) }}
            </span>
            <div class="flex min-w-0 flex-col gap-1">
              <CostList :costs="arrival.cargo" aria-label="Cargo" />
              <span class="truncate text-xs text-ui-dim">
                {{ arrival.ships }} from {{ shortId(arrival.asteroidId) }}
              </span>
            </div>
          </li>
        </ol>
        <p v-else class="text-[13px] text-ui-soft">
          No cargo on the way. Miners load cargo when they reach their asteroid.
        </p>
      </section>

      <!-- Where it comes from, and what runs out. -->
      <section class="flex flex-col gap-2" aria-label="Sources">
        <div class="flex items-center justify-between gap-2">
          <h3 class="ui-label">
            Sources ({{ workingMiners }} {{ workingMiners === 1 ? 'miner' : 'miners' }})
          </h3>
          <span
            v-if="idleMiners > 0"
            class="rounded bg-[#2a200b] px-2 py-0.5 text-xs text-ui-amber"
          >
            {{ idleMiners }} idle
          </span>
        </div>
        <button
          v-for="source in sources"
          :key="source.asteroidId"
          type="button"
          class="ui-card text-left transition hover:border-ui-cyan/40"
          @click="selectedAsteroidId = source.asteroidId"
        >
          <div class="flex items-center gap-2">
            <span
              class="h-2.5 w-2.5 shrink-0 rounded-full"
              :style="{ background: resourceColor(source.primaryResourceKey) }"
            />
            <span class="font-semibold text-ui-bright">{{
              sourceName(source.primaryResourceKey)
            }}</span>
            <span class="ui-num flex-1 text-xs text-ui-dim">{{ shortId(source.asteroidId) }}</span>
            <span class="ui-num font-semibold text-ui-cyan"
              >~{{ formatRate(source.perHour) }}/h</span
            >
          </div>
          <ul
            v-if="source.byResource.length > 1"
            class="ui-num flex flex-wrap gap-x-3 gap-y-1 text-xs text-ui-soft"
            aria-label="Yield per resource"
          >
            <li
              v-for="entry in source.byResource"
              :key="entry.resourceKey"
              class="flex items-center gap-1"
              :title="resourceName(entry.resourceKey)"
            >
              <img
                :src="resources[entry.resourceKey].image"
                :alt="resourceName(entry.resourceKey)"
                class="h-4 w-4 object-contain"
              />{{ formatRate(entry.perHour) }}
            </li>
          </ul>
          <span class="text-xs text-ui-muted">
            {{ source.miners }} {{ source.miners === 1 ? 'miner' : 'miners' }}, ~{{
              formatRate(source.miners > 0 ? source.perHour / source.miners : 0)
            }}/h each<template v-if="source.depletionHours !== null"
              >,
              <span :class="source.depletionHours < 24 ? 'text-ui-amber' : ''"
                >depleted in {{ formatWait(source.depletionHours) }}</span
              >
            </template>
          </span>
        </button>
        <p v-if="sources.length === 0" class="text-[13px] text-ui-soft">
          No miners assigned. Select an asteroid on the map to start mining.
        </p>
      </section>
    </div>
    <p v-else class="animate-pulse px-[18px] py-4 text-ui-muted">Loading income…</p>

    <AsteroidPanel
      v-if="selectedAsteroidId"
      :asteroid-id="selectedAsteroidId"
      :station-id="stationId"
      @close="selectedAsteroidId = null"
      @refresh="overview.refreshStation(stationId)"
    />
  </div>
</template>
