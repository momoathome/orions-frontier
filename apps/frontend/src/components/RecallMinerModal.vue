<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { apiClient, apiErrorMessage } from '../lib/api-client';

export interface AssignmentGroup {
  stationId: string;
  spacecraftDefinitionId: string;
  spacecraftName: string;
  ids: string[];
  totalAmount: number;
  isOwn: boolean;
  recallRequested: boolean;
}

const props = defineProps<{
  show: boolean;
  ownGroups: AssignmentGroup[];
  asteroidId: string;
}>();

const emit = defineEmits<{ close: []; done: [] }>();
const selectedAssignmentId = ref('');
const recallError = ref<string | null>(null);
const recalling = ref(false);

watch(
  () => props.show,
  (show) => {
    if (!show) return;
    selectedAssignmentId.value = props.ownGroups[0]?.ids[0] ?? '';
    recallError.value = null;
    recalling.value = false;
  }
);

const selectedGroup = computed(
  () => props.ownGroups.find((group) => group.ids[0] === selectedAssignmentId.value) ?? null
);

async function submit() {
  if (!selectedGroup.value) return;
  recalling.value = true;
  recallError.value = null;
  try {
    await apiClient.delete(
      `/asteroids/${props.asteroidId}/assignments/${selectedGroup.value.ids[0]}`
    );
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
        class="bg-[#060c1b] border border-red-400/20 rounded p-5 w-80 flex flex-col gap-4 font-mono"
      >
        <div class="flex items-center justify-between">
          <span class="text-[10px] text-white/50 uppercase tracking-widest">Recall Miners</span>
          <button @click="emit('close')" class="text-white/30 hover:text-white/60 text-[11px]">
            ✕
          </button>
        </div>

        <div v-if="ownGroups.length === 0" class="text-[10px] text-white/30 text-center py-3">
          No active miner groups assigned
        </div>

        <template v-else>
          <div class="flex flex-col gap-1.5">
            <label class="text-[9px] text-white/25 uppercase tracking-wider">Miner group</label>
            <select
              v-model="selectedAssignmentId"
              class="bg-white/5 border border-white/10 rounded px-2 h-7 text-[11px] text-white/80 focus:outline-none focus:border-red-400/30"
            >
              <option v-for="group in ownGroups" :key="group.ids[0]" :value="group.ids[0]">
                {{ group.spacecraftName }} (×{{ group.totalAmount }})
              </option>
            </select>
          </div>

          <p class="text-[9px] text-white/35 leading-relaxed">
            The complete group finishes its current load, returns to the station and then becomes
            available again. No new cycle will start.
          </p>

          <div v-if="recallError" class="text-[9px] text-red-400/80">{{ recallError }}</div>

          <button
            @click="submit"
            :disabled="recalling || !selectedGroup"
            class="h-7 rounded text-[9px] uppercase tracking-widest bg-red-400/10 text-red-400/80 border border-red-400/25 hover:bg-red-400/15 hover:text-red-400 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {{ recalling ? 'Requesting…' : 'Recall group' }}
          </button>
        </template>
      </div>
    </div>
  </transition>
</template>
