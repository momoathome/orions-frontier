<script setup lang="ts">
import { ref, computed } from 'vue';
import { apiClient, apiErrorMessage } from '../lib/api-client';
import type { SpacecraftBuildOrder, SpacecraftRole } from '@orions-frontier/shared';
import { roleThemes, hideBrokenImage } from '../lib/spacecraft-utils';
import { formatBuildTime } from '../lib/format';
import BuildForm from './BuildForm.vue';
import ConfirmCancelButton from './ConfirmCancelButton.vue';
import { useOverviewStore } from '../stores/overview.js';

type BuildOrder = SpacecraftBuildOrder & { spacecraftName: string; spacecraftRole: SpacecraftRole };

const { stationId } = defineProps<{ stationId: string }>();
const overview = useOverviewStore();

// The overview store loads and refreshes the fleet; this tab only keeps its selection.
const response = computed(() => overview.state.details[stationId]?.fleet ?? null);
const fleet = computed(() => response.value?.spacecrafts ?? []);
const roleFilter = ref<SpacecraftRole | 'all'>('all');
const activeKey = ref<string | null>(null);
const activeShip = computed(
  () => fleet.value.find((e) => e.definition.key === activeKey.value) ?? fleet.value[0] ?? null
);
const productionSlots = computed(() => response.value?.productionSlots ?? 1);

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
  return orders.sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt));
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

const visibleOrders = computed(() =>
  allBuildOrders.value.filter((o) => Date.parse(o.endsAt) > overview.state.now)
);

function timeUntil(isoStr: string): string {
  const ms = Date.parse(isoStr) - overview.state.now;
  return ms <= 0 ? 'Done' : formatBuildTime(Math.ceil(ms / 1000));
}

const cancellingOrder = ref<string | null>(null);
const orderError = ref<string | null>(null);
async function cancelOrder(orderId: string) {
  cancellingOrder.value = orderId;
  orderError.value = null;
  try {
    await apiClient.delete(`/stations/${stationId}/spacecrafts/orders/${orderId}`);
    void overview.refreshStation(stationId);
  } catch (cause) {
    orderError.value = apiErrorMessage(cause, 'Order could not be cancelled');
  } finally {
    cancellingOrder.value = null;
  }
}
</script>

<template>
  <div v-if="!response" class="flex flex-1 items-center justify-center">
    <p class="animate-pulse text-ui-muted">Loading fleet…</p>
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
            @click="activeKey = entry.definition.key"
          >
            <span
              class="w-1 self-stretch rounded-full"
              :class="roleThemes[entry.definition.role].topBar"
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
                :class="entry.amount > 0 ? roleThemes[entry.definition.role].amount : 'text-ui-dim'"
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
                    roleThemes[activeShip.definition.role].badge,
                    roleThemes[activeShip.definition.role].badgeText,
                  ]"
                  >{{ activeShip.definition.role }}</span
                >
              </div>
              <dl class="grid grid-cols-4 gap-2 text-xs text-ui-muted">
                <div class="flex flex-col">
                  <dt>Fleet</dt>
                  <dd class="ui-num text-sm" :class="roleThemes[activeShip.definition.role].amount">
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
                    stat.value > 0
                      ? roleThemes[activeShip.definition.role].statValue
                      : 'text-ui-dim'
                  "
                >
                  {{ stat.value }}
                </dd>
              </div>
              <div class="h-1 overflow-hidden rounded-full bg-ui-line">
                <div
                  class="h-full rounded-full opacity-70"
                  :class="roleThemes[activeShip.definition.role].topBar"
                  :style="{ width: `${statPct(stat.value, stat.max)}%` }"
                />
              </div>
            </div>
          </dl>
        </section>

        <BuildForm
          :station-id="stationId"
          :ship="activeShip"
          :hangar="response.hangar"
          :production-slots="productionSlots"
          :build-time-factor="response.buildTimeFactor"
          @built="overview.refreshStation(stationId)"
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
          :class="
            i === 0 ? [roleThemes[order.spacecraftRole].topBar, 'animate-pulse'] : 'bg-ui-dim'
          "
        />
        <span :class="i === 0 ? 'text-ui-text' : 'text-ui-muted'">{{ order.spacecraftName }}</span>
        <span class="ui-num font-semibold" :class="roleThemes[order.spacecraftRole].amount"
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
