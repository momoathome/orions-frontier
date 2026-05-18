<script setup lang="ts">
import { ref, onUnmounted } from 'vue';
import { wsClient } from '../lib/ws-client';
import { apiClient } from '../lib/api-client';
import type { StationBuildingWithDefinition } from '@orions-frontier/shared';
import { resourceLabels } from '../lib/spacecraft-utils';

const props = defineProps<{ stationId: string }>();
const emit = defineEmits<{ queueCount: [count: number] }>();

const buildings = ref<StationBuildingWithDefinition[]>([]);
const activeBuilding = ref<StationBuildingWithDefinition | null>(null);
const buildingsLoading = ref(false);
const buildingsError = ref<string | null>(null);
const upgrading = ref<string | null>(null);

function formatResourceKey(key: string): string {
  return resourceLabels[key] ?? key;
}

function upgradeTimeRemaining(building: StationBuildingWithDefinition): string | null {
  if (!building.upgradeEndsAt) return null;
  const ms = new Date(building.upgradeEndsAt).getTime() - Date.now();
  if (ms <= 0) return null;
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function loadBuildings(force = false) {
  if (buildings.value.length > 0 && !force) return;
  buildingsLoading.value = true;
  buildingsError.value = null;
  try {
    const { data } = await apiClient.get(`/stations/${props.stationId}/buildings`);
    buildings.value = data.data.buildings;
    if (!activeBuilding.value && buildings.value.length > 0) {
      activeBuilding.value = buildings.value[0]!;
    } else if (activeBuilding.value) {
      const refreshed = buildings.value.find(
        (b) => b.definition.key === activeBuilding.value!.definition.key,
      );
      if (refreshed) activeBuilding.value = refreshed;
    }
  } catch {
    buildingsError.value = 'Failed to load buildings';
  } finally {
    buildingsLoading.value = false;
  }
  emit('queueCount', buildings.value.filter((b) => b.isUpgrading).length);
}

async function startUpgrade(building: StationBuildingWithDefinition) {
  if (upgrading.value || building.isUpgrading) return;
  upgrading.value = building.definition.key;
  try {
    await apiClient.post(
      `/stations/${props.stationId}/buildings/${building.definition.key}/upgrade`,
    );
    await loadBuildings(true);
  } catch (err: any) {
    const msg = err?.response?.data?.message ?? 'Upgrade failed';
    buildingsError.value = msg;
    setTimeout(() => {
      buildingsError.value = null;
    }, 4000);
  } finally {
    upgrading.value = null;
  }
}

loadBuildings();

const unsubscribe = wsClient.on('building_upgrade_completed', (payload) => {
  const p = payload as { stationId?: string };
  if (p?.stationId === props.stationId) loadBuildings(true);
});

onUnmounted(() => unsubscribe());
</script>

<template>
  <!-- Loading -->
  <div v-if="buildingsLoading" class="flex-1 flex items-center justify-center">
    <div class="flex items-center gap-2 text-cyan-400/50 text-[10px] uppercase tracking-widest">
      <span
        class="inline-block w-3 h-3 border border-cyan-400/50 border-t-cyan-400 rounded-full animate-spin"
      />
      Loading buildings…
    </div>
  </div>

  <!-- Error -->
  <div
    v-else-if="buildingsError && buildings.length === 0"
    class="flex-1 flex items-center justify-center"
  >
    <p class="text-rose-400/60 text-[10px] uppercase tracking-widest">{{ buildingsError }}</p>
  </div>

  <!-- Empty -->
  <div v-else-if="buildings.length === 0" class="flex-1 flex items-center justify-center">
    <p class="text-white/15 text-[9px] uppercase tracking-[0.4em]">No buildings found</p>
  </div>

  <!-- Content -->
  <div v-else class="flex-1 grid grid-cols-[260px_1fr] overflow-hidden">
    <!-- List -->
    <div class="border-r border-white/5 overflow-y-auto">
      <div
        v-for="b in buildings"
        :key="b.definition.id"
        @click="activeBuilding = b"
        class="flex items-center gap-3 px-4 py-2.5 border-b border-white/4 cursor-pointer transition-colors"
        :class="
          activeBuilding?.definition.id === b.definition.id
            ? 'bg-cyan-500/8'
            : 'hover:bg-white/2.5'
        "
      >
        <span
          class="w-1.5 h-1.5 rounded-full shrink-0 mt-0.5"
          :class="b.isUpgrading ? 'bg-amber-400 animate-pulse' : 'bg-cyan-500/40'"
        />
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/75">{{ b.definition.name }}</span>
            <span class="text-[10px] text-cyan-400/50 tabular-nums">Lv.{{ b.level }}</span>
          </div>
          <div class="mt-1.5 h-px w-full bg-white/6 rounded-full overflow-hidden">
            <div
              v-if="b.isUpgrading"
              class="h-full bg-amber-400/60 rounded-full animate-pulse w-full"
            />
          </div>
        </div>
        <span class="text-[9px] text-white/15 shrink-0">▶</span>
      </div>
    </div>

    <!-- Detail -->
    <div v-if="activeBuilding" class="overflow-y-auto p-4">
      <div class="flex gap-4 h-full">
        <div class="flex-1 min-w-0">
          <!-- Header -->
          <div class="flex items-baseline gap-2.5 mb-1">
            <span class="text-[9px] text-cyan-400/35 uppercase tracking-[0.35em]">Module</span>
            <span class="text-[15px] font-semibold tracking-wide text-white">{{
              activeBuilding.definition.name
            }}</span>
            <span
              v-if="activeBuilding.level < activeBuilding.definition.maxLevel"
              class="text-[10px] text-white/25 tabular-nums"
            >
              Lv.{{ activeBuilding.level }} → {{ activeBuilding.level + 1 }}
            </span>
            <span v-else class="text-[9px] text-amber-400/60 uppercase tracking-widest">Max</span>
          </div>
          <p class="text-[11px] text-white/35 leading-relaxed mb-4">
            {{ activeBuilding.definition.description }}
          </p>

          <!-- Current effects -->
          <div class="mb-3">
            <span class="text-[9px] text-white/20 uppercase tracking-widest block mb-1.5"
              >Current</span
            >
            <div class="flex flex-wrap gap-1.5">
              <div
                v-for="effect in activeBuilding.effects"
                :key="effect.type"
                class="flex items-center gap-1.5 px-2 py-1 rounded bg-cyan-500/5 border border-cyan-500/15"
              >
                <span class="text-[9px] text-white/25 uppercase tracking-wider">{{
                  effect.type.replace(/_/g, ' ')
                }}</span>
                <span class="text-[10px] text-cyan-300/70 tabular-nums font-medium">{{
                  effect.value
                }}</span>
              </div>
            </div>
          </div>

          <!-- Next level effects -->
          <div v-if="activeBuilding.nextLevelEffects" class="mb-3">
            <span class="text-[9px] text-white/20 uppercase tracking-widest block mb-1.5"
              >Next level</span
            >
            <div class="flex flex-wrap gap-1.5">
              <div
                v-for="effect in activeBuilding.nextLevelEffects"
                :key="effect.type"
                class="flex items-center gap-1.5 px-2 py-1 rounded bg-green-500/5 border border-green-500/15"
              >
                <span class="text-[9px] text-white/25 uppercase tracking-wider">{{
                  effect.type.replace(/_/g, ' ')
                }}</span>
                <span class="text-[10px] text-green-300/70 tabular-nums font-medium">{{
                  effect.value
                }}</span>
              </div>
            </div>
          </div>

          <!-- Upgrade costs -->
          <div
            v-if="activeBuilding.upgradeCosts.length > 0"
            class="flex items-center gap-2 flex-wrap mb-3"
          >
            <div
              v-for="cost in activeBuilding.upgradeCosts"
              :key="cost.resourceKey"
              class="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-white/2.5 border border-white/6"
            >
              <span class="text-[9px] uppercase tracking-widest text-white/25">{{
                formatResourceKey(cost.resourceKey)
              }}</span>
              <span class="text-[11px] text-white/65 tabular-nums">{{
                cost.amount.toLocaleString()
              }}</span>
            </div>
          </div>

          <!-- Unlock milestones -->
          <div v-if="Object.keys(activeBuilding.unlockMilestones).length > 0" class="mb-3">
            <span class="text-[9px] text-white/20 uppercase tracking-widest block mb-1.5"
              >Unlocks</span
            >
            <div class="flex flex-wrap gap-1.5">
              <div
                v-for="(keys, lvl) in activeBuilding.unlockMilestones"
                :key="lvl"
                class="flex items-center gap-1.5 px-2 py-1 rounded border"
                :class="
                  activeBuilding.level >= Number(lvl)
                    ? 'bg-green-500/8 border-green-500/20'
                    : 'bg-white/2.5 border-white/6'
                "
              >
                <span class="text-[9px] text-white/25">Lv.{{ lvl }}</span>
                <span
                  class="text-[9px]"
                  :class="
                    activeBuilding.level >= Number(lvl) ? 'text-green-300/70' : 'text-white/40'
                  "
                >
                  {{ (keys as string[]).join(', ') }}
                </span>
              </div>
            </div>
          </div>

          <!-- Upgrade timer -->
          <div v-if="activeBuilding.isUpgrading">
            <div class="flex items-center justify-between text-[9px] mb-1.5">
              <span class="text-white/25 uppercase tracking-widest">Upgrading</span>
              <span class="text-amber-300 tabular-nums">{{
                upgradeTimeRemaining(activeBuilding) ?? '…'
              }}</span>
            </div>
            <div class="h-1 w-full bg-white/5 rounded-full overflow-hidden">
              <div class="h-full bg-amber-400/65 rounded-full animate-pulse w-full" />
            </div>
          </div>

          <p v-if="buildingsError" class="text-rose-400/70 text-[10px] mt-2">
            {{ buildingsError }}
          </p>
        </div>

        <!-- Action buttons -->
        <div class="shrink-0 w-36 flex flex-col gap-2 justify-end pb-1">
          <button
            @click="startUpgrade(activeBuilding)"
            :disabled="
              activeBuilding.isUpgrading ||
              activeBuilding.level >= activeBuilding.definition.maxLevel ||
              !!upgrading
            "
            class="w-full py-2.5 rounded border text-[10px] uppercase tracking-[0.2em] font-semibold transition"
            :class="
              activeBuilding.isUpgrading ||
              activeBuilding.level >= activeBuilding.definition.maxLevel ||
              !!upgrading
                ? 'border-amber-500/25 bg-amber-500/8 text-amber-400/50 cursor-not-allowed'
                : 'border-cyan-500/40 bg-cyan-500/9 hover:bg-cyan-500/20 text-cyan-200'
            "
          >
            <span v-if="activeBuilding.level >= activeBuilding.definition.maxLevel">Max Level</span>
            <span v-else-if="activeBuilding.isUpgrading">Upgrading…</span>
            <span v-else-if="upgrading === activeBuilding.definition.key">Starting…</span>
            <span v-else>Upgrade</span>
          </button>
        </div>
      </div>
    </div>

    <div v-else class="flex items-center justify-center">
      <p class="text-white/15 text-[9px] uppercase tracking-[0.4em]">Select a building</p>
    </div>
  </div>
</template>
