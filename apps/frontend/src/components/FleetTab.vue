<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { wsClient } from '../lib/ws-client';
import { apiClient } from '../lib/api-client';
import type { StationSpacecraftWithDefinition, SpacecraftRole } from '@orions-frontier/shared';
import { roleTheme, formatBuildTime } from '../lib/spacecraft-utils';
import BuildForm from './BuildForm.vue';
import type { BuildOrder } from '../lib/spacecraft-utils';

const props = defineProps<{ stationId: string }>();
const emit = defineEmits<{ queueCount: [count: number] }>();

const fleet = ref<StationSpacecraftWithDefinition[]>([]);
const fleetLoading = ref(false);
const fleetError = ref<string | null>(null);
const roleFilter = ref<SpacecraftRole | 'all'>('all');
const activeShip = ref<StationSpacecraftWithDefinition | null>(null);
const hangar = ref({ used: 0, capacity: 0 });

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

// Reference maxes per stat. Using fleet-local maxes so bars are always relative
// to what the player has — a ship that dominates in a stat always looks dominant.

const fleetMaxStats = computed(() => {
  let attack = 1,
    defense = 1,
    speed = 1,
    cargo = 1,
    miningRate = 1;
  for (const e of fleet.value) {
    const d = e.definition;
    if (d.attack > attack) attack = d.attack;
    if (d.defense > defense) defense = d.defense;
    if (d.speed > speed) speed = d.speed;
    if (d.cargo > cargo) cargo = d.cargo;
    if (d.miningRate > miningRate) miningRate = d.miningRate;
  }
  return { attack, defense, speed, cargo, miningRate };
});

function statPct(value: number, max: number): number {
  return max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
}

async function loadFleet(force = false) {
  if (fleet.value.length > 0 && !force) return;
  if (!force) fleetLoading.value = true;
  fleetError.value = null;
  try {
    const response = await apiClient.get(`/stations/${props.stationId}/spacecrafts`);
    fleet.value = response.spacecrafts;
    hangar.value = response.hangar;
    if (!activeShip.value && fleet.value.length > 0) {
      activeShip.value = fleet.value[0]!;
    } else if (activeShip.value) {
      const refreshed = fleet.value.find(
        (e) => e.definition.key === activeShip.value!.definition.key
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
const nowInterval = setInterval(() => {
  now.value = Date.now();
}, 1000);
onUnmounted(() => clearInterval(nowInterval));

const visibleOrders = computed(() =>
  allBuildOrders.value.filter((o) => new Date(o.endsAt).getTime() > now.value)
);

const activeOrdersCount = computed(() => visibleOrders.value.length);

function timeUntil(isoStr: string): string {
  const ms = new Date(isoStr).getTime() - now.value;
  if (ms <= 0) return 'Done';
  return formatBuildTime(Math.ceil(ms / 1000));
}

watch(activeOrdersCount, (count) => emit('queueCount', count), { immediate: true });

loadFleet();

const unsubscribeBuild = wsClient.on('spacecraft_build_completed', (payload) => {
  const p = payload as { stationId?: string };
  if (p?.stationId === props.stationId) loadFleet(true);
});
const unsubscribeMining = wsClient.on('mining_tick_completed', () => loadFleet(true));
const unsubscribeTransport = wsClient.on('transport_tick_completed', () => loadFleet(true));

onUnmounted(() => {
  unsubscribeBuild();
  unsubscribeMining();
  unsubscribeTransport();
});
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
      <span class="mr-3 text-[9px] text-white/35">
        Hangar {{ hangar.used }}/{{ hangar.capacity }}
      </span>
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

    <!-- Main: 2-column split -->
    <div
      class="flex-1 grid grid-cols-[200px_1fr] overflow-hidden relative"
      :style="
        activeShip
          ? {
              background: `radial-gradient(ellipse at 75% 35%, ${
                activeShip.definition.role === 'fighter'
                  ? 'rgb(239 68 68 / 0.08)'
                  : activeShip.definition.role === 'miner'
                    ? 'rgb(245 158 11 / 0.08)'
                    : 'rgb(167 139 250 / 0.08)'
              } 0%, transparent 65%)`,
            }
          : {}
      "
    >
      <div class="border-r border-white/5 overflow-y-auto flex flex-col gap-px p-2">
        <button
          v-for="entry in filteredFleet"
          :key="entry.definition.key"
          @click="activeShip = entry"
          class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-left transition-all border"
          :class="
            activeShip?.definition.key === entry.definition.key
              ? 'bg-white/7 border-white/12'
              : 'border-transparent hover:bg-white/3 hover:border-white/6'
          "
        >
          <div
            class="w-0.5 self-stretch rounded-full shrink-0 opacity-70"
            :class="roleTheme(entry.definition.role).topBar"
          />
          <div class="w-8 h-8 shrink-0 flex items-center justify-center relative">
            <span class="text-white/8 text-[16px] absolute select-none pointer-events-none">◈</span>
            <img
              v-if="entry.definition.image"
              :src="entry.definition.image"
              :alt="entry.definition.name"
              class="w-full h-full object-contain relative z-10 transition-opacity"
              :class="entry.amount > 0 ? 'opacity-70' : 'opacity-25'"
              @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
            />
          </div>
          <div class="flex-1 min-w-0 flex flex-col gap-1">
            <div class="flex items-center justify-between gap-1">
              <span class="text-[10px] text-white/60 truncate leading-none font-medium">{{
                entry.definition.name
              }}</span>
              <span
                class="text-[10px] tabular-nums font-semibold leading-none shrink-0"
                :class="
                  entry.amount > 0 ? roleTheme(entry.definition.role).amount : 'text-white/15'
                "
                >×{{ entry.amount }}</span
              >
            </div>
            <div class="flex items-center gap-1.5">
              <div class="flex-1 h-px bg-white/8 rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full transition-all"
                  :class="roleTheme(entry.definition.role).topBar"
                  :style="{
                    width:
                      entry.amount > 0
                        ? ((entry.amount - entry.lockedAmount) / entry.amount) * 100 + '%'
                        : '0%',
                    opacity: '0.65',
                  }"
                />
              </div>
              <span class="text-[8px] text-white/20 tabular-nums leading-none shrink-0"
                >{{ entry.amount - entry.lockedAmount }}/{{ entry.amount }}</span
              >
            </div>
          </div>
        </button>
        <p
          v-if="filteredFleet.length === 0"
          class="text-[9px] text-white/15 uppercase tracking-widest text-center py-6"
        >
          None
        </p>
      </div>

      <div v-if="activeShip" class="overflow-y-auto flex flex-col">
        <!-- Compact header: image + name + badge + counts in one row -->
        <div class="flex items-center relative gap-3 px-4 py-3 border-b border-white/5 shrink-0">
          <!-- Ship image small -->
          <div class="w-12 h-12 shrink-0 flex items-center justify-center relative">
            <div
              class="absolute inset-0 rounded-full blur-xl opacity-25 pointer-events-none"
              :class="roleTheme(activeShip.definition.role).topBar"
            />
            <span class="text-white/5 text-[28px] absolute select-none pointer-events-none">◈</span>
            <img
              v-if="activeShip.definition.image"
              :src="activeShip.definition.image"
              :alt="activeShip.definition.name"
              class="w-full h-full object-contain relative z-10 drop-shadow-lg"
            />
          </div>

          <!-- Identity + counts -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <h2 class="text-[13px] font-semibold text-white/90 truncate leading-none">
                {{ activeShip.definition.name }}
              </h2>
              <span
                class="shrink-0 px-1.5 py-0.5 rounded text-[7px] uppercase tracking-widest border"
                :class="roleTheme(activeShip.definition.role).badge"
              >
                <span :class="roleTheme(activeShip.definition.role).badgeText">{{
                  activeShip.definition.role
                }}</span>
              </span>
            </div>
            <p class="text-[10px] leading-none">
              <span class="text-white/30">Fleet </span>
              <span
                class="font-semibold tabular-nums"
                :class="roleTheme(activeShip.definition.role).amount"
                >{{ activeShip.amount }}</span
              >
              <span class="text-white/20 mx-1.5">·</span>
              <span class="text-white/30">Idle </span>
              <span class="font-semibold tabular-nums text-emerald-400">{{
                activeShip.amount - activeShip.lockedAmount
              }}</span>
              <span class="text-white/20 mx-1.5">·</span>
              <span class="text-white/30">Busy </span>
              <span class="font-semibold tabular-nums text-white/40">{{
                activeShip.lockedAmount
              }}</span>
            </p>
            <!-- Availability bar -->
            <div
              class="mt-2 h-0.5 bg-white/5 rounded-full absolute bottom-0 left-0 w-full overflow-hidden"
            >
              <div
                class="h-full transition-all"
                :class="roleTheme(activeShip.definition.role).topBar"
                :style="{
                  width:
                    activeShip.amount > 0
                      ? ((activeShip.amount - activeShip.lockedAmount) / activeShip.amount) * 100 +
                        '%'
                      : '0%',
                  opacity: '0.5',
                }"
              />
            </div>
          </div>
        </div>

        <!-- Stats + Build split -->
        <div class="flex-1 grid grid-cols-[1fr_1fr] overflow-hidden min-h-0">
          <!-- Stats: 2-col compact grid -->
          <div class="p-4 border-r border-white/5 overflow-y-auto">
            <div class="pt-3 grid grid-cols-2 gap-x-5 gap-y-2.5">
              <div
                v-for="stat in [
                  {
                    label: 'Attack',
                    value: activeShip.definition.attack,
                    max: fleetMaxStats.attack,
                    show:
                      activeShip.definition.attack > 0 || activeShip.definition.role === 'fighter',
                  },
                  {
                    label: 'Defense',
                    value: activeShip.definition.defense,
                    max: fleetMaxStats.defense,
                    show: true,
                  },
                  {
                    label: 'Speed',
                    value: activeShip.definition.speed,
                    max: fleetMaxStats.speed,
                    show: true,
                  },
                  {
                    label: 'Cargo',
                    value: activeShip.definition.cargo,
                    max: fleetMaxStats.cargo,
                    show: activeShip.definition.cargo > 0,
                  },
                  {
                    label: 'Mining',
                    value: activeShip.definition.miningRate,
                    max: fleetMaxStats.miningRate,
                    show: activeShip.definition.miningRate > 0,
                  },
                ].filter((s) => s.show)"
                :key="stat.label"
                class="flex flex-col gap-0.5"
              >
                <div class="flex items-center justify-between">
                  <span class="text-[8px] text-white/25 uppercase tracking-widest">{{
                    stat.label
                  }}</span>
                  <span
                    class="text-[9px] font-semibold tabular-nums"
                    :class="
                      stat.value > 0
                        ? roleTheme(activeShip.definition.role).statValue
                        : 'text-white/15'
                    "
                    >{{ stat.value }}</span
                  >
                </div>
                <div class="h-0.5 bg-white/6 rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all"
                    :class="
                      stat.value > 0 ? roleTheme(activeShip.definition.role).topBar : 'bg-white/10'
                    "
                    :style="{
                      width: statPct(stat.value, stat.max) + '%',
                      opacity: stat.value > 0 ? '0.6' : '0.2',
                    }"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Build form -->
          <div class="p-4 overflow-y-auto">
            <BuildForm :station-id="stationId" :ship="activeShip" @built="loadFleet(true)" />
          </div>
        </div>
      </div>

      <!-- No selection -->
      <div v-else class="flex items-center justify-center">
        <p class="text-white/15 text-[9px] uppercase tracking-[0.4em]">Select a spacecraft</p>
      </div>
    </div>

    <!-- Bottom: Production Queue ticker (horizontal, shown when orders exist) -->
    <div
      v-if="visibleOrders.length > 0"
      class="border-t border-white/5 bg-[#040911]/60 shrink-0 flex items-center gap-2 px-3 h-9 overflow-x-auto"
    >
      <span class="text-[7px] text-white/20 uppercase tracking-[0.35em] shrink-0">Queue</span>
      <div class="w-px h-3 bg-white/10 shrink-0" />
      <div
        v-for="(order, i) in visibleOrders"
        :key="order.id"
        class="flex items-center gap-1.5 px-2 py-1 rounded border shrink-0 transition-all"
        :class="i === 0 ? 'border-white/12 bg-white/5' : 'border-white/6 bg-transparent'"
      >
        <span
          class="w-1.5 h-1.5 rounded-full shrink-0"
          :class="
            i === 0 ? [roleTheme(order.spacecraftRole).topBar, 'animate-pulse'] : 'bg-white/12'
          "
        />
        <span class="text-[9px] shrink-0" :class="i === 0 ? 'text-white/70' : 'text-white/35'">{{
          order.spacecraftName
        }}</span>
        <span
          class="text-[9px] tabular-nums font-semibold shrink-0"
          :class="roleTheme(order.spacecraftRole).amount"
          >×{{ order.amount }}</span
        >
        <span class="text-[9px] tabular-nums text-white/30 shrink-0">{{
          timeUntil(order.endsAt)
        }}</span>
      </div>
    </div>
  </div>
</template>
