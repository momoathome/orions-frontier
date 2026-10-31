<script setup lang="ts">
import { resourceName } from '../../shared/lib/resources';
import { computed, ref, watch } from 'vue';
import type { DebrisField } from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../../shared/api/api-client';
import { useStationStore } from '../station/index.js';
import PanelShell from '../../shared/ui/PanelShell.vue';

const { field, stationId } = defineProps<{ field: DebrisField; stationId: string }>();
const emit = defineEmits<{ close: []; launched: [] }>();
const stationStore = useStationStore();

// eslint-disable-next-line vue/no-setup-props-reactivity-loss -- Startwert; der Watcher unten lädt bei jedem Feldwechsel nach.
const current = ref(field);
const salvagers = computed(() =>
  (stationStore.state.details[stationId]?.fleet?.spacecrafts ?? []).filter(
    (entry) => entry.definition.role === 'salvager' && entry.amount > entry.lockedAmount
  )
);
const selectedSpacecraftKey = ref('');
const amount = ref(1);
const sending = ref(false);
const feedback = ref<string | null>(null);
const resources = computed(() =>
  Object.entries(current.value.resources).filter(([, value]) => value)
);

// Keep a valid ship selected while the fleet reloads.
watch(
  salvagers,
  (ships) => {
    if (!ships.some((ship) => ship.definition.key === selectedSpacecraftKey.value)) {
      selectedSpacecraftKey.value = ships[0]?.definition.key ?? '';
    }
  },
  { immediate: true }
);

watch(
  () => field.id,
  async (id) => {
    feedback.value = null;
    current.value = field;
    try {
      const response = await apiClient.get<DebrisField>(`/debris/${id}`);
      // A later click may have picked another field meanwhile.
      if (id === field.id) current.value = response;
    } catch (error) {
      if (id === field.id)
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
  <PanelShell
    label="Debris field"
    eyebrow="Debris field"
    title="Recoverable wreckage"
    @close="emit('close')"
  >
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
  </PanelShell>
</template>
