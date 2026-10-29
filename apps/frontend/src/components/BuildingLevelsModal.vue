<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import {
  calculateBuildingBuildTime,
  calculateBuildingEffect,
  calculateBuildingUpgradeCost,
  getSpacecraft,
} from '@orions-frontier/game-config';
import type { BuildingKey } from '@orions-frontier/shared';
import { formatBuildingEffect, formatBuildTime } from '../lib/format';
import { useOverviewStore } from '../stores/overview.js';
import CostList from './CostList.vue';
import UiModal from './UiModal.vue';

const { stationId, initialKey } = defineProps<{ stationId: string; initialKey: BuildingKey }>();
const emit = defineEmits<{ close: [] }>();
const overview = useOverviewStore();
const picked = ref<BuildingKey | null>(null);
const activeKey = computed(() => picked.value ?? initialKey);
const table = useTemplateRef('table');

const buildings = computed(() => overview.state.details[stationId]?.buildings ?? []);
const stock = computed(() => overview.state.details[stationId]?.resources?.resources);
const building = computed(
  () => buildings.value.find((entry) => entry.definition.key === activeKey.value) ?? null
);

// Everything below comes from game-config, so the whole table costs no request.
const rows = computed(() => {
  const current = building.value;
  if (!current) return [];
  const { key, maxLevel } = current.definition;
  return Array.from({ length: maxLevel }, (_, index) => {
    const level = index + 1;
    return {
      level,
      effects: calculateBuildingEffect(key, level).map((effect) =>
        formatBuildingEffect(effect.type, effect.value)
      ),
      costs: level > 1 ? calculateBuildingUpgradeCost(key, level) : [],
      buildTime: level > 1 ? formatBuildTime(calculateBuildingBuildTime(key, level)) : null,
      unlocks: (current.unlockMilestones[level] ?? []).map(
        (spacecraftKey) => getSpacecraft(spacecraftKey)?.name ?? spacecraftKey
      ),
      state: stateFor(level, current.level, current.isUpgrading),
    };
  });
});

type LevelState = 'current' | 'next' | 'upgrading' | 'reached' | 'later';

function stateFor(level: number, currentLevel: number, upgrading: boolean): LevelState {
  return level === currentLevel
    ? 'current'
    : level === currentLevel + 1
      ? upgrading
        ? 'upgrading'
        : 'next'
      : level < currentLevel
        ? 'reached'
        : 'later';
}

const STATE_LABEL: Partial<Record<LevelState, string>> = {
  current: 'Current',
  next: 'Next',
  upgrading: 'Upgrading',
};

// Land on the current level, not on level 1, whenever a tab opens.
watch(
  activeKey,
  async () => {
    await nextTick();
    table.value
      ?.querySelector('[data-state="current"]')
      ?.scrollIntoView({ block: 'center', behavior: 'instant' });
  },
  { immediate: true }
);
</script>

<template>
  <UiModal
    :title="building?.definition.name ?? 'Building'"
    :eyebrow="building ? `Level ${building.level} of ${building.definition.maxLevel}` : undefined"
    wide
    @close="emit('close')"
  >
    <div class="flex flex-col gap-4">
      <nav class="flex flex-wrap gap-1" aria-label="Buildings">
        <button
          v-for="entry in buildings"
          :key="entry.definition.key"
          type="button"
          class="ui-tab"
          :class="{ 'ui-tab-active': entry.definition.key === activeKey }"
          :aria-current="entry.definition.key === activeKey ? 'page' : undefined"
          @click="picked = entry.definition.key"
        >
          {{ entry.definition.name }}
          <span class="ui-num text-ui-dim">{{ entry.level }}</span>
        </button>
      </nav>

      <p v-if="building?.definition.description" class="text-[13px] text-ui-muted">
        {{ building.definition.description }}
      </p>

      <div ref="table">
        <table class="w-full border-separate border-spacing-y-1 text-[13px]">
          <thead class="ui-label text-left">
            <tr>
              <th class="w-14 px-2 py-1 font-normal">Lv.</th>
              <th class="px-2 py-1 font-normal">Effect</th>
              <th class="px-2 py-1 font-normal">Upgrade cost · time</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.level"
              :data-state="row.state"
              :class="{
                'bg-[#0c2a30]': row.state === 'current',
                'bg-ui-card': row.state === 'next',
                'bg-[#2a200b]': row.state === 'upgrading',
                'opacity-50': row.state === 'reached',
              }"
            >
              <td class="rounded-l-md px-2 py-2 align-top">
                <span class="ui-num font-semibold text-ui-bright">{{ row.level }}</span>
                <span
                  v-if="STATE_LABEL[row.state]"
                  class="block text-[11px]"
                  :class="{
                    'text-ui-cyan': row.state === 'current',
                    'text-ui-muted': row.state === 'next',
                    'text-ui-amber': row.state === 'upgrading',
                  }"
                  >{{ STATE_LABEL[row.state] }}</span
                >
              </td>
              <td class="px-2 py-2 align-top">
                <div v-for="effect in row.effects" :key="effect.label" class="text-ui-soft">
                  {{ effect.label }}
                  <span class="ui-num text-ui-bright">{{ effect.display }}</span>
                </div>
                <div v-if="row.unlocks.length > 0" class="text-xs text-ui-green">
                  Unlocks {{ row.unlocks.join(', ') }}
                </div>
              </td>
              <td class="rounded-r-md px-2 py-2 align-top">
                <CostList
                  v-if="row.costs.length > 0"
                  :costs="row.costs"
                  :stock="row.state === 'next' ? stock : null"
                  :duration="row.buildTime"
                />
                <span v-else class="text-ui-dim">Starting level</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-xs text-ui-dim">Build times without research speed-ups.</p>
    </div>
  </UiModal>
</template>
