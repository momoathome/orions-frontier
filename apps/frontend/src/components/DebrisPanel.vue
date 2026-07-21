<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { DebrisField, StationSpacecraftWithDefinition } from '@orions-frontier/shared';
import { apiClient, apiErrorMessage } from '../lib/api-client';

const props = defineProps<{ field: DebrisField; stationId: string }>();
const emit = defineEmits<{ close: []; launched: [] }>();

const current = ref(props.field);
const salvagers = ref<StationSpacecraftWithDefinition[]>([]);
const selectedDefinitionId = ref('');
const amount = ref(1);
const sending = ref(false);
const feedback = ref<string | null>(null);
const resources = computed(() =>
  Object.entries(current.value.resources).filter(([, value]) => value)
);

watch(
  () => props.field.id,
  async () => {
    feedback.value = null;
    salvagers.value = [];
    selectedDefinitionId.value = '';
    try {
      const [fieldResponse, fleetResponse] = await Promise.all([
        apiClient.get(`/debris/${props.field.id}`),
        apiClient.get(`/stations/${props.stationId}/spacecrafts`),
      ]);
      current.value = fieldResponse.data;
      salvagers.value = fleetResponse.data.spacecrafts.filter(
        (entry: StationSpacecraftWithDefinition) =>
          entry.definition.role === 'salvager' && entry.amount > entry.lockedAmount
      );
      selectedDefinitionId.value = salvagers.value[0]?.definition.id ?? '';
    } catch (error) {
      feedback.value = apiErrorMessage(error, 'Debris data could not be loaded');
    }
  },
  { immediate: true }
);

async function launch(): Promise<void> {
  if (!selectedDefinitionId.value) return;
  sending.value = true;
  feedback.value = null;
  try {
    await apiClient.post(`/debris/${current.value.id}/salvage`, {
      stationId: props.stationId,
      spacecraftDefinitionId: selectedDefinitionId.value,
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
  <div
    class="absolute bottom-0 left-0 z-20 flex min-h-48 w-full cursor-default flex-col border-t-2 border-violet-400/35 bg-[#060c1b]/97 font-mono backdrop-blur-xl"
  >
    <div class="flex h-11 items-center justify-between border-b border-white/7 px-5">
      <span class="text-sm font-semibold tracking-widest text-violet-200">DEBRIS FIELD</span>
      <button class="h-7 w-7 text-white/50" @click="$emit('close')">✕</button>
    </div>
    <div class="grid flex-1 grid-cols-2 gap-8 px-5 py-4 text-[10px]">
      <div>
        <p class="mb-2 text-[9px] uppercase tracking-[0.3em] text-white/20">Recoverable</p>
        <div
          v-for="[key, value] in resources"
          :key="key"
          class="flex justify-between border-b border-white/5 py-1"
        >
          <span class="text-white/40">{{ key }}</span>
          <span class="text-violet-200">{{ value }}</span>
        </div>
      </div>
      <div class="flex flex-col gap-2 border-l border-white/5 pl-5">
        <p class="text-[9px] uppercase tracking-[0.3em] text-white/20">Salvage</p>
        <template v-if="salvagers.length">
          <select
            v-model="selectedDefinitionId"
            class="h-7 rounded border border-white/10 bg-[#080d18] px-2"
          >
            <option v-for="ship in salvagers" :key="ship.definition.id" :value="ship.definition.id">
              {{ ship.definition.name }} ({{ ship.amount - ship.lockedAmount }} ready)
            </option>
          </select>
          <input
            v-model.number="amount"
            type="number"
            min="1"
            class="h-7 rounded border border-white/10 bg-white/5 px-2"
          />
          <button
            :disabled="sending || amount < 1"
            class="h-7 rounded border border-violet-400/30 text-violet-200 disabled:opacity-30"
            @click="launch"
          >
            {{ sending ? 'Launching…' : 'Recover' }}
          </button>
        </template>
        <p v-else class="text-white/25">No salvager is available.</p>
        <p v-if="feedback" class="text-white/50">{{ feedback }}</p>
      </div>
    </div>
  </div>
</template>
