<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BuildingKey } from '@orions-frontier/shared';
import { formatBuildingEffect } from '../../shared/lib/format';
import BuildingLevelsModal from './BuildingLevelsModal.vue';
import BuildSlots from './BuildSlots.vue';
import UpgradeCard from './UpgradeCard.vue';
import { useStationStore } from './store.js';

const { stationId } = defineProps<{ stationId: string }>();
const stationStore = useStationStore();
const error = ref<string | null>(null);
const levelsKey = ref<BuildingKey | null>(null);

const detail = computed(() => stationStore.state.details[stationId] ?? null);

const cards = computed(() =>
  (detail.value?.buildings ?? []).map((building) => {
    const nextUnlock = Object.entries(building.unlockMilestones)
      .map(([level, keys]) => ({ level: Number(level), keys }))
      .filter((entry) => entry.level > building.level)
      .sort((a, b) => a.level - b.level)[0];
    return {
      building,
      effects: building.effects.map((effect) => {
        const next = building.nextLevelEffects?.find((n) => n.type === effect.type);
        return {
          ...formatBuildingEffect(effect.type, effect.value),
          next: next ? formatBuildingEffect(next.type, next.value).display : null,
        };
      }),
      nextUnlock: nextUnlock
        ? `Lv. ${nextUnlock.level} unlocks ${nextUnlock.keys.join(', ')}`
        : null,
    };
  })
);
</script>

<template>
  <div class="flex flex-col gap-2.5 overflow-y-auto px-[18px] py-3.5">
    <p v-if="!detail" class="animate-pulse text-ui-muted">Loading buildings…</p>
    <p v-else-if="detail.buildings.length === 0" class="text-ui-soft">No buildings found.</p>
    <BuildSlots :station-id="stationId" />
    <p v-if="error" class="ui-error">{{ error }}</p>

    <UpgradeCard
      v-for="card in cards"
      :key="card.building.definition.key"
      :station-id="stationId"
      :item="card.building"
      class="cursor-pointer transition hover:border-ui-cyan/40"
      @error="error = $event"
      @click="levelsKey = card.building.definition.key"
    >
      <template #title>
        <button
          type="button"
          class="hover:underline"
          :aria-label="`${card.building.definition.name} levels`"
          @click.stop="levelsKey = card.building.definition.key"
        >
          {{ card.building.definition.name }}
        </button>
      </template>
      <template #default="{ maxed }">
        <div
          v-for="effect in card.effects"
          :key="effect.label"
          class="flex items-baseline gap-2 text-[13px] text-ui-soft"
        >
          <span>{{ effect.label }}</span>
          <span class="ui-num text-ui-bright">{{ effect.display }}</span>
          <template v-if="effect.next && !maxed">
            <span class="text-ui-dim">→</span>
            <span class="ui-num font-semibold text-ui-green">{{ effect.next }}</span>
          </template>
        </div>
      </template>
      <template v-if="card.nextUnlock" #footer>
        <span class="text-xs text-ui-muted">{{ card.nextUnlock }}</span>
      </template>
    </UpgradeCard>

    <BuildingLevelsModal
      v-if="levelsKey"
      :station-id="stationId"
      :initial-key="levelsKey"
      @close="levelsKey = null"
    />
  </div>
</template>
