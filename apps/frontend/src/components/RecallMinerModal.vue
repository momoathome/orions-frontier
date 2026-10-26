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

const { asteroidId, ownGroups, show } = defineProps<{
  show: boolean;
  ownGroups: AssignmentGroup[];
  asteroidId: string;
}>();

const emit = defineEmits<{ close: []; done: [] }>();
const selectedAssignmentId = ref('');
const recallAmount = ref(1);
const recallError = ref<string | null>(null);
const recalling = ref(false);
const submitLabel = computed(() => {
  if (recalling.value) return 'Requesting…';
  return recallAmount.value === 1 ? 'Recall miner' : 'Recall miners';
});

watch(
  () => show,
  (isShown) => {
    if (!isShown) return;
    selectedAssignmentId.value = ownGroups[0]?.ids[0] ?? '';
    recallAmount.value = 1;
    recallError.value = null;
    recalling.value = false;
  }
);

const selectedGroup = computed(
  () => ownGroups.find((group) => group.ids[0] === selectedAssignmentId.value) ?? null
);
const availableAmount = computed(() =>
  selectedGroup.value
    ? selectedGroup.value.totalAmount - selectedGroup.value.recallRequestedAmount
    : 0
);

watch(selectedAssignmentId, () => (recallAmount.value = 1));

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
  <transition
    enter-active-class="transition-opacity duration-150"
    enter-from-class="opacity-0"
    leave-active-class="transition-opacity duration-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="show"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="emit('close')"
    >
      <div
        class="bg-[#060c1b] border border-red-400/20 rounded p-5 w-96 max-w-[calc(100vw-2rem)] flex flex-col gap-4 font-mono"
      >
        <div class="flex items-center justify-between">
          <span class="text-[12px] text-white/65 uppercase tracking-wider">Recall Miner</span>
          <button
            type="button"
            class="text-white/45 hover:text-white/80 text-[14px]"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>

        <div v-if="ownGroups.length === 0" class="text-[12px] text-white/45 text-center py-3">
          No active miner groups assigned
        </div>

        <template v-else>
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] text-white/45 uppercase tracking-wide">Miner type</label>
            <select
              v-model="selectedAssignmentId"
              class="bg-white/5 border border-white/10 rounded px-2 h-8 text-[12px] text-white/85 focus:outline-none focus:border-red-400/30"
            >
              <option v-for="group in ownGroups" :key="group.ids[0]" :value="group.ids[0]">
                {{ group.spacecraftName }} (×{{ group.totalAmount - group.recallRequestedAmount }}
                active)
              </option>
            </select>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] text-white/45 uppercase tracking-wide">Amount</label>
            <input
              v-model.number="recallAmount"
              type="number"
              min="1"
              :max="availableAmount"
              class="bg-white/5 border border-white/10 rounded px-2 h-8 text-[12px] text-white/85 focus:outline-none focus:border-red-400/30"
            />
          </div>

          <p class="text-[11px] text-white/45 leading-relaxed">
            Recalled miners finish their current round trips and become available at the station.
            The remaining group continues mining.
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
    </div>
  </transition>
</template>
