<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { wsClient } from '../lib/ws-client';
import { apiClient } from '../lib/api-client';
import type { StationSpacecraftWithDefinition, SpacecraftRole } from '@orions-frontier/shared';
import { roleTheme, type BuildOrder } from '../lib/spacecraft-utils';
import SpacecraftStats from './SpacecraftStats.vue';
import BuildQueue from './BuildQueue.vue';
import BuildForm from './BuildForm.vue';

const props = defineProps<{ stationId: string }>();
const emit = defineEmits<{ queueCount: [count: number] }>();

const fleet = ref<StationSpacecraftWithDefinition[]>([]);
const fleetLoading = ref(false);
const fleetError = ref<string | null>(null);
const roleFilter = ref<SpacecraftRole | 'all'>('all');
const activeShip = ref<StationSpacecraftWithDefinition | null>(null);

const uniqueRoles = computed(
  () => [...new Set(fleet.value.map((e) => e.definition.role))] as SpacecraftRole[]
);

const filteredFleet = computed(() =>
  roleFilter.value === 'all'
    ? fleet.value
    : fleet.value.filter((e) => e.definition.role === roleFilter.value)
);

const allBuildOrders = computed((): BuildOrder[] => {
  const orders: BuildOrder[] = [];
  for (const entry of fleet.value) {
    for (const order of entry.buildOrders) {
      orders.push({
        id: order.id,
        amount: order.amount,
        endsAt: order.endsAt,
        spacecraftName: entry.definition.name,
        spacecraftRole: entry.definition.role,
      });
    }
  }
  return orders.sort((a, b) => new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime());
});

async function loadFleet(force = false) {
  if (fleet.value.length > 0 && !force) return;
  if (!force) fleetLoading.value = true;
  fleetError.value = null;
  try {
    const { data } = await apiClient.get(`/stations/${props.stationId}/spacecrafts`);
    fleet.value = data.data.spacecrafts;
    if (!activeShip.value && fleet.value.length > 0) {
      activeShip.value = fleet.value[0]!;
    } else if (activeShip.value) {
      const refreshed = fleet.value.find(
        (e) => e.definition.id === activeShip.value!.definition.id
      );
      if (refreshed) activeShip.value = refreshed;
    }
  } catch {
    fleetError.value = 'Failed to load fleet data';
  } finally {
    fleetLoading.value = false;
  }
}

// Tick every second so the active-order count stays in sync with the timer
const now = ref(Date.now());
const nowInterval = setInterval(() => { now.value = Date.now(); }, 1000);
onUnmounted(() => clearInterval(nowInterval));

const activeOrdersCount = computed(() =>
  allBuildOrders.value.filter((o) => new Date(o.endsAt).getTime() > now.value).length,
);

watch(activeOrdersCount, (count) => emit('queueCount', count), { immediate: true });

loadFleet();

const unsubscribe = wsClient.on('spacecraft_build_completed', (payload) => {
  const p = payload as { stationId?: string };
  if (p?.stationId === props.stationId) loadFleet(true);
});

onUnmounted(() => unsubscribe());
</script>

<template>
  <!-- Loading -->
  <div v-if="fleetLoading" class="flex-1 flex items-center justify-center">
    <div class="flex items-center gap-2 text-cyan-400/50 text-[10px] uppercase tracking-widest">
      <span
        class="inline-block w-3 h-3 border border-cyan-400/50 border-t-cyan-400 rounded-full animate-spin"
      />
      Loading fleet…
    </div>
  </div>

  <!-- Error -->
  <div v-else-if="fleetError" class="flex-1 flex items-center justify-center">
    <p class="text-rose-400/60 text-[10px] uppercase tracking-widest">{{ fleetError }}</p>
  </div>

  <!-- Empty -->
  <div v-else-if="fleet.length === 0" class="flex-1 flex items-center justify-center">
    <p class="text-white/15 text-[9px] uppercase tracking-[0.4em]">No spacecraft assigned</p>
  </div>

  <!-- Content -->
  <div v-else class="flex-1 overflow-hidden flex flex-col">
    <!-- Role filter bar -->
    <div
      class="flex items-center gap-0.5 px-3 h-8 border-b border-white/5 bg-[#040911]/40 shrink-0"
    >
      <button
        @click="roleFilter = 'all'"
        class="px-2.5 h-5 rounded text-[9px] uppercase tracking-[0.2em] transition"
        :class="
          roleFilter === 'all'
            ? 'bg-white/10 text-white/65 border border-white/15'
            : 'text-white/25 hover:text-white/50'
        "
      >
        All
      </button>
      <button
        v-for="role in uniqueRoles"
        :key="role"
        @click="roleFilter = role"
        class="px-2.5 h-5 rounded text-[9px] uppercase tracking-[0.2em] transition border"
        :class="
          roleFilter === role
            ? [roleTheme(role).badge, roleTheme(role).badgeText]
            : 'border-transparent text-white/25 hover:text-white/50'
        "
      >
        {{ role }}
      </button>
    </div>

    <!-- Main: icon grid + detail -->
    <div class="flex-1 grid grid-cols-[33%_1fr] overflow-hidden">
      <!-- Icon grid -->
      <div class="border-r border-white/5 overflow-y-auto p-3">
        <div class="grid grid-cols-7 gap-1.5">
          <div
            v-for="entry in filteredFleet"
            :key="entry.definition.id"
            @click="activeShip = entry"
            class="flex flex-col items-center gap-1 pt-1.5 pb-2 px-1 rounded cursor-pointer border transition-all"
            :class="
              activeShip?.definition.id === entry.definition.id
                ? 'bg-white/8 border-white/20'
                : 'border-white/5 hover:bg-white/4 hover:border-white/12'
            "
          >
            <div
              class="w-full h-0.5 rounded-full"
              :class="roleTheme(entry.definition.role).topBar"
            />
            <div class="w-9 h-9 relative flex items-center justify-center">
              <span class="text-white/10 text-[20px] absolute select-none pointer-events-none"
                >◈</span
              >
              <img
                v-if="entry.definition.image"
                :src="entry.definition.image"
                :alt="entry.definition.name"
                class="w-full h-full object-contain opacity-65 relative z-10"
                @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
              />
            </div>
            <span
              class="text-[8px] text-white/40 text-center leading-tight w-full truncate px-0.5"
              >{{ entry.definition.name }}</span
            >
            <span
              class="text-[11px] font-semibold tabular-nums leading-none"
              :class="entry.amount > 0 ? roleTheme(entry.definition.role).amount : 'text-white/20'"
              >×{{ entry.amount }}</span
            >
          </div>
        </div>
        <p
          v-if="filteredFleet.length === 0"
          class="text-[9px] text-white/15 uppercase tracking-widest text-center mt-4"
        >
          None
        </p>
      </div>

      <!-- Detail -->
      <div v-if="activeShip" class="overflow-hidden p-4 flex gap-4">
        <!-- Left: header + stats + form -->
        <div class="flex flex-col gap-4 flex-1 min-w-0 overflow-y-auto">
          <!-- Header -->
          <div class="flex items-center gap-2.5">
            <span class="text-[15px] font-semibold text-white tracking-wide">
              {{ activeShip.definition.name }}
            </span>
            <span
              class="px-1.5 py-px rounded text-[8px] uppercase tracking-widest border"
              :class="roleTheme(activeShip.definition.role).badge"
              ><span :class="roleTheme(activeShip.definition.role).badgeText">
                {{ activeShip.definition.role }}
              </span>
            </span>
            <span class="ml-auto text-[9px] text-white/25"
              >In fleet:
              <span
                class="font-semibold tabular-nums"
                :class="
                  activeShip.amount > 0
                    ? roleTheme(activeShip.definition.role).amount
                    : 'text-white/30'
                "
              >
                {{ activeShip.amount.toLocaleString() }}
              </span>
            </span>
          </div>

          <!-- Stats + Resources -->
          <SpacecraftStats :ship="activeShip" />

          <!-- Build form -->
          <BuildForm :station-id="stationId" :ship="activeShip" @built="loadFleet(true)" />
        </div>

        <!-- Right: scrollable queue -->
        <div class="w-52 shrink-0 overflow-y-auto border-l border-white/5 pl-4">
          <BuildQueue :orders="allBuildOrders" />
        </div>
      </div>

      <div v-else class="flex items-center justify-center">
        <p class="text-white/15 text-[9px] uppercase tracking-[0.4em]">Select a spacecraft</p>
      </div>
    </div>
  </div>
</template>
