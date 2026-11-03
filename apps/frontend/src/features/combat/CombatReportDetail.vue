<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { getSpacecraft } from '@orions-frontier/game-config';
import type { CombatParty, CombatReport } from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../../shared/api/api-client';
import { resourceName } from '../../shared/lib/resources';
import { useAuthStore } from '../auth/index.js';

const { combatId } = defineProps<{ combatId: string }>();
const auth = useAuthStore();
const report = ref<CombatReport | null>(null);
const error = ref<string | null>(null);

watch(
  () => combatId,
  async (id) => {
    report.value = null;
    error.value = null;
    try {
      report.value = await apiClient.get<CombatReport>(`/me/combats/${id}`);
    } catch (cause) {
      error.value = apiErrorMessage(cause, 'Combat report could not be loaded');
    }
  },
  { immediate: true }
);

const isAttack = computed(() => report.value?.attackerUserId === auth.user?.id);
const outcome = computed(() => {
  const current = report.value;
  if (!current) return '';
  if (current.status === 'traveling') return 'En route';
  if (current.winner === null) return 'Target already destroyed, fleet turned back';
  return current.winner === (isAttack.value ? 'attacker' : 'defender') ? 'Victory' : 'Defeat';
});

const shipName = (key: string) => getSpacecraft(key)?.name ?? key;
const party = (side: CombatParty | null) =>
  side ? `${side.userName}, ${side.stationName} (${side.x} / ${side.y})` : 'Unknown';

/** Ships per key with the number lost; `null` losses stay unseen, a missing key lost none. */
function shipRows(ships: Record<string, number> | null, losses: Record<string, number> | null) {
  return Object.entries(ships ?? {})
    .filter(([, amount]) => amount > 0)
    .map(([key, amount]) => ({
      key,
      name: shipName(key),
      amount,
      lost: losses ? (losses[key] ?? 0) : null,
    }));
}

const attackerShips = computed(() =>
  report.value ? shipRows(report.value.attackerFleet, report.value.attackerShipLosses) : []
);
const defenderShips = computed(() =>
  report.value
    ? shipRows(report.value.scouting?.dockedShips ?? null, report.value.defenderShipLosses)
    : []
);
const loot = computed(() =>
  Object.entries(report.value?.loot ?? {}).filter(([, amount]) => amount > 0)
);
const time = computed(() =>
  report.value
    ? new Date(report.value.arrivesAt).toLocaleString(undefined, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''
);
</script>

<template>
  <p v-if="error" class="ui-error">{{ error }}</p>
  <article v-else-if="report" class="flex flex-col gap-4 text-sm" aria-live="polite">
    <header class="flex items-baseline justify-between gap-3">
      <span class="font-semibold text-ui-bright">{{ isAttack ? 'Attack' : 'Defense' }}</span>
      <span :class="outcome === 'Victory' ? 'text-ui-green' : 'text-ui-amber'">{{ outcome }}</span>
      <time class="ml-auto tabular-nums text-ui-muted" :datetime="report.arrivesAt">
        {{ time }}
      </time>
    </header>

    <section class="ui-card gap-1.5">
      <h3 class="ui-label">Attacker</h3>
      <p class="text-ui-text">{{ party(report.attacker) }}</p>
      <table v-if="attackerShips.length > 0" class="w-full text-[13px]">
        <thead class="text-left text-xs text-ui-muted">
          <tr>
            <th class="font-normal">Ship</th>
            <th class="text-right font-normal">Sent</th>
            <th class="text-right font-normal">Lost</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="ship in attackerShips" :key="ship.key">
            <td class="text-ui-soft">{{ ship.name }}</td>
            <td class="ui-num text-right text-ui-bright">{{ ship.amount }}</td>
            <td class="ui-num text-right text-ui-red">{{ ship.lost ?? '?' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="text-xs text-ui-muted">Fleet composition unknown.</p>
    </section>

    <section class="ui-card gap-1.5">
      <h3 class="ui-label">Defender</h3>
      <p class="text-ui-text">{{ party(report.defender) }}</p>
      <template v-if="report.scouting">
        <p class="text-[13px] text-ui-soft">
          Station defense
          <span class="ui-num text-ui-bright">{{ report.scouting.stationDefense }}</span>
        </p>
        <table v-if="defenderShips.length > 0" class="w-full text-[13px]">
          <thead class="text-left text-xs text-ui-muted">
            <tr>
              <th class="font-normal">Docked ship</th>
              <th class="text-right font-normal">Docked</th>
              <th class="text-right font-normal">Lost</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ship in defenderShips" :key="ship.key">
              <td class="text-ui-soft">{{ ship.name }}</td>
              <td class="ui-num text-right text-ui-bright">{{ ship.amount }}</td>
              <td class="ui-num text-right text-ui-red">{{ ship.lost ?? '?' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="text-xs text-ui-muted">No docked ships.</p>
      </template>
      <p v-else-if="report.winner !== null" class="text-xs text-ui-muted">
        No ship flew home to report the defense. {{ report.defenderLosses }} defender losses.
      </p>
    </section>

    <section v-if="report.winner !== null" class="ui-card gap-1.5">
      <h3 class="ui-label">Result</h3>
      <dl class="flex flex-col gap-1 text-[13px]">
        <div v-for="[key, amount] in loot" :key="key" class="flex justify-between">
          <dt class="text-ui-soft">{{ resourceName(key) }} looted</dt>
          <dd class="ui-num text-ui-bright">{{ amount.toLocaleString('en-US') }}</dd>
        </div>
        <div v-if="loot.length === 0" class="flex justify-between">
          <dt class="text-ui-soft">Loot</dt>
          <dd class="text-ui-muted">none</dd>
        </div>
        <div v-if="report.stationDestroyed" class="flex justify-between">
          <dt class="text-ui-soft">Station</dt>
          <dd class="text-ui-red">destroyed</dd>
        </div>
        <div v-else-if="report.integrityDamage > 0" class="flex justify-between">
          <dt class="text-ui-soft">Integrity</dt>
          <dd class="ui-num text-ui-bright">
            −{{ report.integrityDamage }} to {{ isAttack ? '≤ ' : ''
            }}{{ report.defenderIntegrity }}%
          </dd>
        </div>
      </dl>
    </section>
  </article>
  <p v-else class="animate-pulse text-ui-muted">Loading report…</p>
</template>
