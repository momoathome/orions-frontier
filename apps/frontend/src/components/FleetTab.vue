<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { wsClient } from '../lib/ws-client';
import { debounced } from '../lib/debounce';
import { apiClient, apiErrorMessage } from '../lib/api-client';
import type {
  StationSpacecraftsResponse,
  StationSpacecraftWithDefinition,
  SpacecraftRole,
} from '@orions-frontier/shared';
import { roleTheme, formatBuildTime, hideBrokenImage } from '../lib/spacecraft-utils';
import BuildForm from './BuildForm.vue';
import ConfirmCancelButton from './ConfirmCancelButton.vue';
import { useOverviewStore } from '../stores/overview.js';
import type { BuildOrder } from '../lib/spacecraft-utils';

const { stationId } = defineProps<{ stationId: string }>();
const overview = useOverviewStore();

const fleet = ref<StationSpacecraftWithDefinition[]>([]);
const fleetLoading = ref(false);
const fleetError = ref<string | null>(null);
const roleFilter = ref<SpacecraftRole | 'all'>('all');
const activeShip = ref<StationSpacecraftWithDefinition | null>(null);
const hangar = ref({ used: 0, capacity: 0 });
const productionSlots = ref(1);
const buildTimeFactor = ref(1);

const uniqueRoles = computed(() => [...new Set(fleet.value.map((e) => e.definition.role))]);

const ROLE_GLOW: Record<SpacecraftRole, string> = {
  fighter: 'rgb(239 68 68 / 0.08)',
  bomber: 'rgb(249 115 22 / 0.08)',
  miner: 'rgb(245 158 11 / 0.08)',
  salvager: 'rgb(167 139 250 / 0.08)',
};

const activeShipGlow = computed(() =>
  activeShip.value
    ? {
        background: `radial-gradient(ellipse at 75% 35%, ${ROLE_GLOW[activeShip.value.definition.role]} 0%, transparent 65%)`,
      }
    : {}
);

const activeShipStats = computed(() => {
  if (!activeShip.value) return [];
  const { definition } = activeShip.value;
  return [
    {
      label: 'Attack',
      value: definition.attack,
      max: fleetMaxStats.value.attack,
      show: definition.attack > 0 || definition.role === 'fighter',
    },
    { label: 'Defense', value: definition.defense, max: fleetMaxStats.value.defense, show: true },
    { label: 'Speed', value: definition.speed, max: fleetMaxStats.value.speed, show: true },
    {
      label: 'Cargo',
      value: definition.cargo,
      max: fleetMaxStats.value.cargo,
      show: definition.cargo > 0,
    },
    {
      label: 'Mining',
      value: definition.miningRate,
      max: fleetMaxStats.value.miningRate,
      show: definition.miningRate > 0,
    },
  ].filter((stat) => stat.show);
});

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
    const response = await apiClient.get<StationSpacecraftsResponse>(
      `/stations/${stationId}/spacecrafts`
    );
    fleet.value = response.spacecrafts;
    hangar.value = response.hangar;
    productionSlots.value = response.productionSlots;
    buildTimeFactor.value = response.buildTimeFactor;
    const activeKey = activeShip.value?.definition.key;
    activeShip.value =
      fleet.value.find((e) => e.definition.key === activeKey) ??
      activeShip.value ??
      fleet.value[0] ??
      null;
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
onUnmounted(() => {
  clearInterval(nowInterval);
});

const visibleOrders = computed(() =>
  allBuildOrders.value.filter((o) => new Date(o.endsAt).getTime() > now.value)
);

function timeUntil(isoStr: string): string {
  const ms = new Date(isoStr).getTime() - now.value;
  if (ms <= 0) return 'Done';
  return formatBuildTime(Math.ceil(ms / 1000));
}

void loadFleet();

const cancellingOrder = ref<string | null>(null);
const orderError = ref<string | null>(null);
async function cancelOrder(orderId: string) {
  cancellingOrder.value = orderId;
  orderError.value = null;
  try {
    await apiClient.delete(`/stations/${stationId}/spacecrafts/orders/${orderId}`);
    onBuilt();
  } catch (cause) {
    orderError.value = apiErrorMessage(cause, 'Order could not be cancelled');
  } finally {
    cancellingOrder.value = null;
  }
}

function onBuilt() {
  void loadFleet(true);
  void overview.refreshStation(stationId);
}

const unsubscribeBuild = wsClient.on('spacecraft_build_completed', (payload) => {
  if (payload.stationId === stationId) void loadFleet(true);
});
const reloadFleet = debounced(() => loadFleet(true), 500);
const unsubscribeMining = wsClient.on('mining_tick_completed', reloadFleet);
const unsubscribeTransport = wsClient.on('transport_tick_completed', reloadFleet);
// Hangar, Shipyard and research change crew slots, production slots and which ships unlock.
const unsubscribeBuilding = wsClient.on('building_upgrade_completed', (payload) => {
  if (payload.stationId === stationId) void loadFleet(true);
});
const unsubscribeResearch = wsClient.on('research_completed', reloadFleet);

onUnmounted(() => {
  reloadFleet.cancel();
  unsubscribeBuild();
  unsubscribeMining();
  unsubscribeTransport();
  unsubscribeBuilding();
  unsubscribeResearch();
});
</script>

<template>
  <div v-if="fleetLoading" class="flex flex-1 items-center justify-center">
    <p class="animate-pulse text-ui-muted">Loading fleet…</p>
  </div>

  <div v-else-if="fleetError" class="flex flex-1 items-center justify-center">
    <p class="text-ui-red">{{ fleetError }}</p>
  </div>

  <div v-else-if="fleet.length === 0" class="flex flex-1 items-center justify-center">
    <p class="text-ui-soft">No spacecraft available at this station.</p>
  </div>

  <div v-else class="flex flex-1 flex-col overflow-hidden text-sm">
    <!-- Role filter + hangar -->
    <div class="flex shrink-0 items-center gap-1 border-b border-ui-line px-[18px] py-2.5">
      <button
        type="button"
        class="ui-tab capitalize"
        :class="{ 'ui-tab-active': roleFilter === 'all' }"
        @click="roleFilter = 'all'"
      >
        All
      </button>
      <button
        v-for="role in uniqueRoles"
        :key="role"
        type="button"
        class="ui-tab capitalize"
        :class="{ 'ui-tab-active': roleFilter === role }"
        @click="roleFilter = role"
      >
        {{ role }}
      </button>
    </div>

    <div
      class="flex flex-1 flex-col gap-3 overflow-y-auto px-[18px] py-3.5"
      :style="activeShipGlow"
    >
      <!-- Ship list -->
      <ul class="flex flex-col gap-1" aria-label="Spacecraft">
        <li v-for="entry in filteredFleet" :key="entry.definition.key">
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition"
            :class="[
              activeShip?.definition.key === entry.definition.key
                ? 'border-ui-line-strong bg-ui-card'
                : 'border-transparent hover:border-ui-line hover:bg-ui-card/60',
              entry.blockers.length > 0 && entry.amount === 0 ? 'opacity-50' : '',
            ]"
            :aria-pressed="activeShip?.definition.key === entry.definition.key"
            @click="activeShip = entry"
          >
            <span
              class="w-1 self-stretch rounded-full"
              :class="roleTheme(entry.definition.role).topBar"
            />
            <img
              v-if="entry.definition.image"
              :src="entry.definition.image"
              alt=""
              class="h-9 w-9 shrink-0 object-contain"
              :class="entry.amount > 0 ? '' : 'opacity-40'"
              @error="hideBrokenImage"
            />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate font-semibold text-ui-bright">{{ entry.definition.name }}</span>
              <span class="text-xs capitalize text-ui-muted"
                >{{ entry.definition.role
                }}<template v-if="entry.blockers.length > 0">, locked</template></span
              >
            </span>
            <span class="flex shrink-0 flex-col items-end">
              <span
                class="ui-num font-semibold"
                :class="entry.amount > 0 ? roleTheme(entry.definition.role).amount : 'text-ui-dim'"
                >×{{ entry.amount }}</span
              >
              <span class="ui-num text-xs text-ui-muted"
                >{{ entry.amount - entry.lockedAmount }} idle</span
              >
            </span>
          </button>
        </li>
        <li v-if="filteredFleet.length === 0" class="py-4 text-center text-ui-soft">
          No spacecraft of this role.
        </li>
      </ul>

      <template v-if="activeShip">
        <!-- Selected ship -->
        <section class="ui-card" :aria-label="activeShip.definition.name">
          <div class="flex items-center gap-3">
            <img
              v-if="activeShip.definition.image"
              :src="activeShip.definition.image"
              alt=""
              class="h-14 w-14 shrink-0 object-contain drop-shadow-lg"
              @error="hideBrokenImage"
            />
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <div class="flex items-center gap-2">
                <h3 class="truncate text-base font-semibold text-ui-bright">
                  {{ activeShip.definition.name }}
                </h3>
                <span
                  class="rounded border px-2 py-0.5 text-xs capitalize"
                  :class="[
                    roleTheme(activeShip.definition.role).badge,
                    roleTheme(activeShip.definition.role).badgeText,
                  ]"
                  >{{ activeShip.definition.role }}</span
                >
              </div>
              <dl class="grid grid-cols-4 gap-2 text-xs text-ui-muted">
                <div class="flex flex-col">
                  <dt>Fleet</dt>
                  <dd class="ui-num text-sm" :class="roleTheme(activeShip.definition.role).amount">
                    {{ activeShip.amount }}
                  </dd>
                </div>
                <div class="flex flex-col">
                  <dt>Idle</dt>
                  <dd class="ui-num text-sm text-ui-green">
                    {{ activeShip.amount - activeShip.lockedAmount }}
                  </dd>
                </div>
                <div class="flex flex-col">
                  <dt>Busy</dt>
                  <dd class="ui-num text-sm text-ui-text">{{ activeShip.lockedAmount }}</dd>
                </div>
                <div class="flex flex-col">
                  <dt>Crew each</dt>
                  <dd class="ui-num text-sm text-ui-text">{{ activeShip.definition.crew }}</dd>
                </div>
              </dl>
            </div>
          </div>

          <dl class="grid grid-cols-2 gap-x-5 gap-y-2.5 border-t border-ui-line pt-3">
            <div v-for="stat in activeShipStats" :key="stat.label" class="flex flex-col gap-1">
              <div class="flex items-baseline justify-between text-[13px]">
                <dt class="text-ui-muted">{{ stat.label }}</dt>
                <dd
                  class="ui-num font-semibold"
                  :class="
                    stat.value > 0 ? roleTheme(activeShip.definition.role).statValue : 'text-ui-dim'
                  "
                >
                  {{ stat.value }}
                </dd>
              </div>
              <div class="h-1 overflow-hidden rounded-full bg-ui-line">
                <div
                  class="h-full rounded-full opacity-70"
                  :class="roleTheme(activeShip.definition.role).topBar"
                  :style="{ width: `${statPct(stat.value, stat.max)}%` }"
                />
              </div>
            </div>
          </dl>
        </section>

        <BuildForm
          :station-id="stationId"
          :ship="activeShip"
          :hangar="hangar"
          :production-slots="productionSlots"
          :build-time-factor="buildTimeFactor"
          @built="onBuilt"
        />
      </template>
    </div>

    <!-- Production queue -->
    <div
      v-if="visibleOrders.length > 0"
      class="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-ui-line px-[18px] py-2.5"
    >
      <span class="ui-label shrink-0"
        >Queue
        <span class="ui-num normal-case tracking-normal text-ui-dim"
          >{{ productionSlots }} {{ productionSlots === 1 ? 'slot' : 'slots' }}</span
        ></span
      >
      <div
        v-for="(order, i) in visibleOrders"
        :key="order.id"
        class="flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[13px]"
        :class="i === 0 ? 'border-ui-line-strong bg-ui-card' : 'border-ui-line'"
      >
        <span
          class="h-1.5 w-1.5 rounded-full"
          :class="i === 0 ? [roleTheme(order.spacecraftRole).topBar, 'animate-pulse'] : 'bg-ui-dim'"
        />
        <span :class="i === 0 ? 'text-ui-text' : 'text-ui-muted'">{{ order.spacecraftName }}</span>
        <span class="ui-num font-semibold" :class="roleTheme(order.spacecraftRole).amount"
          >×{{ order.amount }}</span
        >
        <span class="ui-num text-ui-muted">{{ timeUntil(order.endsAt) }}</span>
        <ConfirmCancelButton
          :busy="cancellingOrder === order.id"
          @confirm="cancelOrder(order.id)"
        />
      </div>
      <span v-if="orderError" class="shrink-0 text-xs text-ui-red">{{ orderError }}</span>
    </div>
  </div>
</template>
