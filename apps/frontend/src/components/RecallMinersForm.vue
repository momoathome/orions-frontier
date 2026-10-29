<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { apiClient, apiErrorMessage } from '../lib/api-client';

export interface AssignmentGroup {
  stationId: string | null;
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
  <div class="flex flex-col gap-4">
    <p v-if="ownGroups.length === 0" class="text-ui-soft">No active miner groups assigned.</p>

    <template v-else>
      <div class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <label class="flex flex-col gap-1.5">
          <span class="text-xs text-ui-muted">Miner type</span>
          <select v-model="selectedAssignmentId" class="ui-input">
            <option v-for="group in ownGroups" :key="group.ids[0]" :value="group.ids[0]">
              {{ group.spacecraftName }} · {{ group.totalAmount - group.recallRequestedAmount }}
              active
            </option>
          </select>
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-xs text-ui-muted">Amount</span>
          <input
            v-model.number="recallAmount"
            type="number"
            min="1"
            :max="availableAmount"
            class="ui-input ui-num w-24"
          />
        </label>
      </div>

      <p class="text-ui-soft">
        Recalled miners finish their current round trip and then stay at the station. The rest of
        the group keeps mining.
      </p>

      <p v-if="recallError" class="text-ui-red">{{ recallError }}</p>
    </template>

    <div class="flex justify-end gap-2 border-t border-ui-line pt-4">
      <button type="button" class="ui-btn" @click="emit('cancel')">Cancel</button>
      <button
        v-if="ownGroups.length > 0"
        type="button"
        :disabled="
          recalling ||
          !selectedGroup ||
          !Number.isInteger(recallAmount) ||
          recallAmount < 1 ||
          recallAmount > availableAmount
        "
        class="ui-btn ui-btn-danger"
        @click="submit"
      >
        {{ submitLabel }}
      </button>
    </div>
  </div>
</template>
