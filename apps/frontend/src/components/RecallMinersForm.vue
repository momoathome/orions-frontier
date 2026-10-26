<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { apiClient, apiErrorMessage } from '../lib/api-client';

export interface AssignmentGroup {
  stationId: string;
  spacecraftKey: string;
  spacecraftName: string;
  ids: string[];
  totalAmount: number;
  isOwn: boolean;
  recallRequestedAmount: number;
  members: { id: string; availableAmount: number }[];
}

const { asteroidId, ownGroups } = defineProps<{
  ownGroups: AssignmentGroup[];
  asteroidId: string;
}>();

const emit = defineEmits<{ cancel: []; done: [] }>();
const selectedAssignmentId = ref('');
const recallAmount = ref(1);
const recallError = ref<string | null>(null);
const recalling = ref(false);
const submitLabel = computed(() => {
  if (recalling.value) return 'Requesting…';
  return recallAmount.value === 1 ? 'Recall miner' : 'Recall miners';
});

const selectedGroup = computed(
  () => ownGroups.find((group) => group.ids[0] === selectedAssignmentId.value) ?? null
);
const availableAmount = computed(() =>
  selectedGroup.value
    ? selectedGroup.value.totalAmount - selectedGroup.value.recallRequestedAmount
    : 0
);

watch(selectedAssignmentId, () => (recallAmount.value = 1));
// Keep a valid selection when the panel reloads its assignments.
watch(
  () => ownGroups,
  (groups) => {
    if (!groups.some((group) => group.ids[0] === selectedAssignmentId.value)) {
      selectedAssignmentId.value = groups[0]?.ids[0] ?? '';
    }
  },
  { immediate: true }
);

async function submit() {
  if (!selectedGroup.value) return;
  recalling.value = true;
  recallError.value = null;
  try {
    let remaining = recallAmount.value;
    const recalls = selectedGroup.value.members.flatMap((member) => {
      const amount = Math.min(remaining, member.availableAmount);
      remaining -= amount;
      return amount > 0
        ? [apiClient.delete(`/asteroids/${asteroidId}/assignments/${member.id}?amount=${amount}`)]
        : [];
    });
    await Promise.all(recalls);
    emit('done');
  } catch (error) {
    recallError.value = apiErrorMessage(error, 'Recall failed');
  } finally {
    recalling.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <span class="text-[10px] text-red-300/70 uppercase tracking-[0.18em]">Recall miners</span>
      <button
        type="button"
        class="text-[10px] text-white/45 hover:text-white/80 uppercase tracking-wider"
        @click="emit('cancel')"
      >
        Back
      </button>
    </div>

    <div v-if="ownGroups.length === 0" class="text-[12px] text-white/45 py-3">
      No active miner groups assigned
    </div>

    <template v-else>
      <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
        <label class="flex flex-col gap-1.5">
          <span class="text-[10px] text-white/45 uppercase tracking-wide">Miner type</span>
          <select
            v-model="selectedAssignmentId"
            class="bg-white/5 border border-white/10 rounded px-2 h-8 text-[12px] text-white/85 focus:outline-none focus:border-red-400/30"
          >
            <option v-for="group in ownGroups" :key="group.ids[0]" :value="group.ids[0]">
              {{ group.spacecraftName }} (×{{ group.totalAmount - group.recallRequestedAmount }}
              active)
            </option>
          </select>
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-[10px] text-white/45 uppercase tracking-wide">Amount</span>
          <input
            v-model.number="recallAmount"
            type="number"
            min="1"
            :max="availableAmount"
            class="w-20 bg-white/5 border border-white/10 rounded px-2 h-8 text-[12px] text-white/85 tabular-nums focus:outline-none focus:border-red-400/30"
          />
        </label>
      </div>

      <p class="text-[11px] text-white/45 leading-relaxed">
        Recalled miners finish their current round trips and become available at the station. The
        remaining group continues mining.
      </p>

      <div v-if="recallError" class="text-[11px] text-red-400/85">{{ recallError }}</div>

      <button
        type="button"
        :disabled="
          recalling ||
          !selectedGroup ||
          !Number.isInteger(recallAmount) ||
          recallAmount < 1 ||
          recallAmount > availableAmount
        "
        class="h-8 rounded text-[11px] uppercase tracking-wider bg-red-400/10 text-red-300/90 border border-red-400/30 hover:bg-red-400/15 hover:text-red-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
        @click="submit"
      >
        {{ submitLabel }}
      </button>
    </template>
  </div>
</template>
