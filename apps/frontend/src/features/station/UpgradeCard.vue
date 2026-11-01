<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  calculateBuildingBuildTime,
  calculateDefenseUpgradeBuildTime,
} from '@orions-frontier/game-config';
import {
  getCostShortfall,
  type StationBuildingWithDefinition,
  type StationDefenseUpgradeWithDefinition,
} from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../../shared/api/api-client';
import { formatBuildTime, formatCountdown, formatShortfall } from '../../shared/lib/format';
import { live } from '../../shared/lib/live.js';
import { useStationStore } from './store.js';
import ConfirmCancelButton from '../../shared/ui/ConfirmCancelButton.vue';
import CostList from '../../shared/ui/CostList.vue';
import { RequirementChips } from '../research/index.js';

/** One building or defense upgrade: level, status, progress, costs and the start/cancel action. */
const { stationId, item } = defineProps<{
  stationId: string;
  item: StationBuildingWithDefinition | StationDefenseUpgradeWithDefinition;
}>();
const emit = defineEmits<{ changed: []; error: [message: string | null] }>();
defineSlots<{
  /** Replaces the plain name in the heading. */
  title?: () => unknown;
  /** The upgrade's effects, between description and progress. */
  default?: (props: { maxed: boolean }) => unknown;
  footer?: () => unknown;
}>();
const stationStore = useStationStore();
const starting = ref(false);
const cancelling = ref(false);

// Only defense upgrades carry blockers and a server build time.
const defense = computed(() => ('blockers' in item ? item : null));
const path = computed(
  () =>
    `/stations/${stationId}/${defense.value ? 'defense' : 'buildings'}/${item.definition.key}/upgrade`
);
const now = computed(() => live.now);
const stock = computed(() => stationStore.state.details[stationId]?.resources ?? null);

function buildSeconds(level: number): number {
  const base =
    'blockers' in item
      ? calculateDefenseUpgradeBuildTime(item.definition.key, level)
      : calculateBuildingBuildTime(item.definition.key, level);
  return base * stationStore.upgradeTimeFactor(stationId);
}

const card = computed(() => {
  const shortfall = getCostShortfall(
    item.upgradeCosts,
    stock.value?.resources ?? {},
    stock.value?.rates ?? {}
  );
  const maxed = item.level >= item.definition.maxLevel;
  // Costs, time and blockers are for the level after everything already queued.
  const canQueue = item.queuedLevel < item.definition.maxLevel;
  const locked = (defense.value?.blockers.length ?? 0) > 0;
  const endsAt = item.upgradeEndsAt ? Date.parse(item.upgradeEndsAt) : null;
  const upgradingNow = item.isUpgrading && endsAt !== null && endsAt > now.value;
  const affordable = canQueue && !locked && shortfall.missing.length === 0;
  const startsNow = stationStore.startsNow(stationId, item);
  const ready = affordable && startsNow;
  // known-limit: assumes today's Core and Construction Robotics levels; a level reached mid-upgrade
  // makes the bar jump. Send `upgradeStartedAt` from the API if that ever matters.
  const durationMs = buildSeconds(item.level + 1) * 1_000;
  const queuedSeconds = defense.value
    ? defense.value.upgradeDurationSeconds
    : buildSeconds(item.queuedLevel + 1);
  return {
    maxed,
    canQueue,
    locked,
    affordable,
    ready,
    action: startsNow ? 'Upgrade' : 'Add to queue',
    queueable: affordable && !stationStore.queueFull(stationId),
    upgradingNow,
    accent: upgradingNow
      ? 'border-[#5a4317]'
      : ready
        ? defense.value
          ? 'border-rose-400/35'
          : 'border-[#1f5b66]'
        : locked
          ? 'opacity-60'
          : '',
    endsAt,
    progress:
      endsAt && durationMs > 0
        ? Math.min(100, Math.max(0, 100 - ((endsAt - now.value) / durationMs) * 100))
        : 0,
    buildTime: queuedSeconds === null ? null : formatBuildTime(queuedSeconds),
    missing: formatShortfall(shortfall),
  };
});

async function run(
  busy: typeof starting,
  request: () => Promise<unknown>,
  failure: string
): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  emit('error', null);
  try {
    await request();
    await stationStore.refreshStation(stationId);
    emit('changed');
  } catch (cause) {
    emit('error', apiErrorMessage(cause, failure));
  } finally {
    busy.value = false;
  }
}

const startUpgrade = () =>
  run(starting, () => apiClient.post(path.value), `${item.definition.name} upgrade failed`);
const cancelUpgrade = () =>
  run(
    cancelling,
    () => apiClient.delete(path.value),
    `${item.definition.name} upgrade could not be cancelled`
  );
</script>

<template>
  <article class="ui-card" :class="card.accent">
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-baseline gap-2">
        <h4 class="text-base font-semibold text-ui-bright">
          <slot name="title">{{ item.definition.name }}</slot>
        </h4>
        <span class="ui-num text-[13px] text-ui-muted">Lv. {{ item.level }}</span>
        <span v-if="item.queuedLevel > item.level" class="ui-num text-[13px] text-ui-amber"
          >→ {{ item.queuedLevel }}</span
        >
      </div>
      <span v-if="card.upgradingNow" class="rounded bg-[#2a200b] px-2 py-0.5 text-xs text-ui-amber"
        >Upgrading</span
      >
      <span v-else-if="card.maxed" class="rounded bg-ui-line px-2 py-0.5 text-xs text-ui-muted"
        >Max level</span
      >
      <span v-else-if="card.locked" class="rounded bg-ui-line px-2 py-0.5 text-xs text-ui-muted"
        >Locked</span
      >
      <span
        v-else-if="card.ready"
        class="rounded px-2 py-0.5 text-xs"
        :class="defense ? 'bg-rose-500/10 text-rose-200' : 'bg-[#0c2a30] text-ui-cyan'"
        >Affordable</span
      >
      <span
        v-else-if="card.affordable"
        class="rounded bg-[#141d2c] px-2 py-0.5 text-xs text-ui-muted"
        >Will queue</span
      >
      <span v-else class="rounded bg-[#141d2c] px-2 py-0.5 text-xs text-ui-muted">Saving</span>
    </div>

    <p v-if="item.definition.description" class="text-[13px] text-ui-muted">
      {{ item.definition.description }}
    </p>

    <slot :maxed="card.maxed" />

    <div v-if="card.upgradingNow && card.endsAt" class="flex flex-col gap-1.5">
      <div class="ui-bar">
        <div
          class="h-full rounded-full bg-ui-amber transition-[width] duration-1000 ease-linear"
          :style="{ width: `${card.progress}%` }"
        />
      </div>
      <div class="flex items-center justify-between gap-3">
        <span class="text-[13px] text-ui-soft">
          Lv. {{ item.level + 1 }} done in
          <strong class="ui-num text-ui-amber">{{ formatCountdown(card.endsAt, now) }}</strong>
        </span>
        <ConfirmCancelButton :busy="cancelling" @confirm="cancelUpgrade" />
      </div>
    </div>

    <RequirementChips v-if="defense && card.locked" :blockers="defense.blockers" />

    <template v-else-if="card.canQueue">
      <div class="flex items-center justify-between gap-3">
        <CostList :costs="item.upgradeCosts" :stock="stock?.resources" :duration="card.buildTime" />
        <button
          type="button"
          class="ui-btn"
          :class="
            card.ready &&
            (defense
              ? 'border-rose-400/35 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20'
              : 'ui-btn-primary')
          "
          :disabled="!card.queueable || starting"
          @click.stop="startUpgrade"
        >
          {{ starting ? 'Starting…' : card.action }}
        </button>
      </div>
      <span v-if="card.missing" class="text-xs text-ui-amber">{{ card.missing }}</span>
    </template>

    <slot name="footer" />
  </article>
</template>
