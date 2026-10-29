<script setup lang="ts">
import { resourceName } from '../lib/mining-utils';
import { computed, ref, watch } from 'vue';
import type {
  StationSpacecraftsResponse,
  DebrisField,
  StationSpacecraftWithDefinition,
} from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../lib/api-client';

const { field, stationId } = defineProps<{ field: DebrisField; stationId: string }>();
const emit = defineEmits<{ close: []; launched: [] }>();

// eslint-disable-next-line vue/no-setup-props-reactivity-loss -- Startwert; der Watcher unten lädt bei jedem Feldwechsel nach.
const current = ref(field);
const salvagers = ref<StationSpacecraftWithDefinition[]>([]);
const selectedSpacecraftKey = ref('');
const amount = ref(1);
const sending = ref(false);
const feedback = ref<string | null>(null);
const resources = computed(() =>
  Object.entries(current.value.resources).filter(([, value]) => value)
);

watch(
  () => field.id,
  async () => {
    feedback.value = null;
    salvagers.value = [];
    selectedSpacecraftKey.value = '';
    try {
      const [fieldResponse, fleetResponse] = await Promise.all([
        apiClient.get<DebrisField>(`/debris/${field.id}`),
        apiClient.get<StationSpacecraftsResponse>(`/stations/${stationId}/spacecrafts`),
      ]);
      current.value = fieldResponse;
      salvagers.value = fleetResponse.spacecrafts.filter(
        (entry) => entry.definition.role === 'salvager' && entry.amount > entry.lockedAmount
      );
      selectedSpacecraftKey.value = salvagers.value[0]?.definition.key ?? '';
    } catch (error) {
      feedback.value = apiErrorMessage(error, 'Debris data could not be loaded');
    }
  },
  { immediate: true }
);

async function launch(): Promise<void> {
  if (!selectedSpacecraftKey.value) return;
  sending.value = true;
  feedback.value = null;
  try {
    await apiClient.post(`/debris/${current.value.id}/salvage`, {
      stationId: stationId,
      spacecraftKey: selectedSpacecraftKey.value,
      amount: amount.value,
    });
    feedback.value = 'Salvage launched.';
    emit('launched');
  } catch (error) {
    feedback.value = apiErrorMessage(error, 'Salvage could not be launched');
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <aside
    class="flex h-full w-[400px] shrink-0 flex-col border-l border-ui-line bg-ui-panel text-left text-sm text-ui-text"
    aria-label="Debris field"
  >
    <div class="flex items-start justify-between gap-3 border-b border-ui-line px-[18px] py-4">
      <div class="flex flex-col gap-1">
        <span class="ui-label">Debris field</span>
        <h2 class="text-xl font-semibold text-ui-bright">Recoverable wreckage</h2>
      </div>
      <button
        type="button"
        class="ui-btn ui-btn-icon"
        aria-label="Close panel"
        @click="$emit('close')"
      >
        ✕
      </button>
    </div>
    <div class="flex flex-1 flex-col gap-5 overflow-y-auto px-[18px] py-4">
      <section class="flex flex-col gap-1">
        <h3 class="ui-label mb-1">Recoverable</h3>
        <div
          v-for="[key, value] in resources"
          :key="key"
          class="flex justify-between border-b border-ui-line py-1.5 last:border-0"
        >
          <span class="text-ui-soft">{{ resourceName(key) }}</span>
          <span class="ui-num text-ui-bright">{{ value }}</span>
        </div>
      </section>
      <section class="flex flex-col gap-3">
        <h3 class="ui-label">Salvage</h3>
        <template v-if="salvagers.length">
          <label class="flex flex-col gap-1.5">
            <span class="text-xs text-ui-muted">Spacecraft</span>
            <select v-model="selectedSpacecraftKey" class="ui-input">
              <option
                v-for="ship in salvagers"
                :key="ship.definition.key"
                :value="ship.definition.key"
              >
                {{ ship.definition.name }} ({{ ship.amount - ship.lockedAmount }} ready)
              </option>
            </select>
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-xs text-ui-muted">Amount</span>
            <input v-model.number="amount" type="number" min="1" class="ui-input ui-num" />
          </label>
        </template>
        <p v-else class="text-ui-soft">No salvager is ready. Build one in the Shipyard (Fleet).</p>
        <p v-if="feedback" class="text-ui-soft">{{ feedback }}</p>
      </section>
    </div>
    <div v-if="salvagers.length" class="border-t border-ui-line px-[18px] py-4">
      <button
        type="button"
        :disabled="sending || amount < 1"
        class="ui-btn ui-btn-primary w-full"
        @click="launch"
      >
        {{ sending ? 'Launching…' : 'Recover' }}
      </button>
    </div>
  </aside>
</template>
