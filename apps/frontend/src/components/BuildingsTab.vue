<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  calculateBuildingBuildTime,
  calculateConstructionSpeedBonus,
} from '@orions-frontier/game-config';
import {
  getCostShortfall,
  type BuildingKey,
  type StationBuildingWithDefinition,
} from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../lib/api-client';
import {
  formatBuildingEffect,
  formatBuildTime,
  formatCountdown,
  formatShortfall,
} from '../lib/format';
import BuildingLevelsModal from './BuildingLevelsModal.vue';
import ConfirmCancelButton from './ConfirmCancelButton.vue';
import CostList from './CostList.vue';
import { useOverviewStore } from '../stores/overview.js';
import { useResearchStore } from '../stores/research.js';

const { stationId } = defineProps<{ stationId: string }>();
const overview = useOverviewStore();
const research = useResearchStore();
const upgrading = ref<string | null>(null);
const cancelling = ref<string | null>(null);
const error = ref<string | null>(null);
const levelsKey = ref<BuildingKey | null>(null);

const detail = computed(() => overview.state.details[stationId] ?? null);
const now = computed(() => overview.state.now);

// Core and Construction Robotics add up; the server never goes below a quarter of the time.
const speedUp = computed(() =>
  Math.min(
    75,
    calculateConstructionSpeedBonus(
      detail.value?.buildings.find((building) => building.definition.key === 'core')?.level ?? 1
    ) + research.modifiers.constructionBonus
  )
);

const cards = computed(() =>
  (detail.value?.buildings ?? []).map((building) => {
    const resources = detail.value?.resources;
    const shortfall = getCostShortfall(
      building.upgradeCosts,
      resources?.resources ?? {},
      resources?.rates ?? {}
    );
    const maxed = building.level >= building.definition.maxLevel;
    const endsAt = building.upgradeEndsAt ? Date.parse(building.upgradeEndsAt) : null;
    const buildSeconds =
      (calculateBuildingBuildTime(building.definition.key, building.level + 1) *
        (100 - speedUp.value)) /
      100;
    const affordable = !maxed && shortfall.missing.length === 0;
    const upgradingNow = building.isUpgrading && endsAt !== null && endsAt > now.value;
    const nextUnlock = Object.entries(building.unlockMilestones)
      .map(([level, keys]) => ({ level: Number(level), keys }))
      .filter((entry) => entry.level > building.level)
      .sort((a, b) => a.level - b.level)[0];
    return {
      building,
      maxed,
      affordable,
      upgradingNow,
      accent: upgradingNow ? 'border-[#5a4317]' : affordable ? 'border-[#1f5b66]' : '',
      endsAt,
      // ponytail: assumes today's Core and Construction Robotics levels; a level reached mid-upgrade
      // makes the bar jump. Send `upgradeStartedAt` from the API if that ever matters.
      progress: endsAt
        ? Math.min(100, Math.max(0, 100 - ((endsAt - now.value) / (buildSeconds * 1_000)) * 100))
        : 0,
      buildTime: formatBuildTime(buildSeconds),
      effects: building.effects.map((effect) => {
        const next = building.nextLevelEffects?.find((n) => n.type === effect.type);
        return {
          ...formatBuildingEffect(effect.type, effect.value),
          next: next ? formatBuildingEffect(next.type, next.value).display : null,
        };
      }),
      missing: formatShortfall(shortfall),
      nextUnlock: nextUnlock
        ? `Lv. ${nextUnlock.level} unlocks ${nextUnlock.keys.join(', ')}`
        : null,
    };
  })
);

async function startUpgrade(building: StationBuildingWithDefinition) {
  if (upgrading.value) return;
  upgrading.value = building.definition.key;
  error.value = null;
  try {
    await apiClient.post(`/stations/${stationId}/buildings/${building.definition.key}/upgrade`);
    await overview.refreshStation(stationId);
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Upgrade failed');
  } finally {
    upgrading.value = null;
  }
}

async function cancelUpgrade(building: StationBuildingWithDefinition) {
  cancelling.value = building.definition.key;
  error.value = null;
  try {
    await apiClient.delete(`/stations/${stationId}/buildings/${building.definition.key}/upgrade`);
    await overview.refreshStation(stationId);
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Upgrade could not be cancelled');
  } finally {
    cancelling.value = null;
  }
}
</script>

<template>
  <div class="flex flex-col gap-2.5 overflow-y-auto px-[18px] py-3.5">
    <p v-if="!detail" class="animate-pulse text-ui-muted">Loading buildings…</p>
    <p v-else-if="detail.buildings.length === 0" class="text-ui-soft">No buildings found.</p>
    <p v-if="error" class="rounded-md border border-[#6b2f2c] bg-[#2a1214] px-3 py-2 text-ui-red">
      {{ error }}
    </p>

    <article
      v-for="card in cards"
      :key="card.building.definition.key"
      class="ui-card cursor-pointer transition hover:border-ui-cyan/40"
      :class="card.accent"
      @click="levelsKey = card.building.definition.key"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-baseline gap-2">
          <h3 class="text-base font-semibold text-ui-bright">
            <button
              type="button"
              class="hover:underline"
              :aria-label="`${card.building.definition.name} levels`"
              @click.stop="levelsKey = card.building.definition.key"
            >
              {{ card.building.definition.name }}
            </button>
          </h3>
          <span class="ui-num text-[13px] text-ui-muted">Lv. {{ card.building.level }}</span>
        </div>
        <span
          v-if="card.upgradingNow"
          class="rounded bg-[#2a200b] px-2 py-0.5 text-xs text-ui-amber"
          >Upgrading</span
        >
        <span v-else-if="card.maxed" class="rounded bg-ui-line px-2 py-0.5 text-xs text-ui-muted"
          >Max level</span
        >
        <span
          v-else-if="card.affordable"
          class="rounded bg-[#0c2a30] px-2 py-0.5 text-xs text-ui-cyan"
          >Affordable</span
        >
        <span v-else class="rounded bg-[#141d2c] px-2 py-0.5 text-xs text-ui-muted">Saving</span>
      </div>

      <p v-if="card.building.definition.description" class="text-[13px] text-ui-muted">
        {{ card.building.definition.description }}
      </p>

      <div
        v-for="effect in card.effects"
        :key="effect.label"
        class="flex items-baseline gap-2 text-[13px] text-ui-soft"
      >
        <span>{{ effect.label }}</span>
        <span class="ui-num text-ui-bright">{{ effect.display }}</span>
        <template v-if="effect.next && !card.maxed">
          <span class="text-ui-dim">→</span>
          <span class="ui-num font-semibold text-ui-green">{{ effect.next }}</span>
        </template>
      </div>

      <div v-if="card.upgradingNow && card.endsAt" class="flex flex-col gap-1.5">
        <div class="ui-bar">
          <div
            class="h-full rounded-full bg-ui-amber transition-[width] duration-1000 ease-linear"
            :style="{ width: `${card.progress}%` }"
          />
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-[13px] text-ui-soft">
            Lv. {{ card.building.level + 1 }} done in
            <strong class="ui-num text-ui-amber">{{ formatCountdown(card.endsAt, now) }}</strong>
          </span>
          <ConfirmCancelButton
            :busy="cancelling === card.building.definition.key"
            @confirm="cancelUpgrade(card.building)"
          />
        </div>
      </div>

      <template v-else-if="!card.maxed">
        <div class="flex items-center justify-between gap-3">
          <CostList
            :costs="card.building.upgradeCosts"
            :stock="detail?.resources?.resources"
            :duration="card.buildTime"
          />
          <button
            type="button"
            class="ui-btn"
            :class="{ 'ui-btn-primary': card.affordable }"
            :disabled="!card.affordable || upgrading !== null"
            @click.stop="startUpgrade(card.building)"
          >
            {{ upgrading === card.building.definition.key ? 'Starting…' : 'Upgrade' }}
          </button>
        </div>
        <span v-if="card.missing" class="text-xs text-ui-amber">{{ card.missing }}</span>
      </template>

      <span v-if="card.nextUnlock" class="text-xs text-ui-muted">{{ card.nextUnlock }}</span>
    </article>

    <BuildingLevelsModal
      v-if="levelsKey"
      :station-id="stationId"
      :initial-key="levelsKey"
      @close="levelsKey = null"
    />
  </div>
</template>
