<script setup lang="ts">
import { ref, watch } from 'vue';
import { apiClient } from '../lib/api-client';

export interface AssignmentGroup {
  stationId: string;
  spacecraftDefinitionId: string;
  spacecraftName: string;
  ids: string[];
  totalAmount: number;
  isOwn: boolean;
}

const props = defineProps<{
  show: boolean;
  recallTarget: AssignmentGroup | null;
  asteroidId: string;
  stationId: string;
}>();

const emit = defineEmits<{
  close: [];
  done: [];
}>();

// ── Internal state ────────────────────────────────────────────────────────────

const recallAmount = ref(1);
const recallError = ref<string | null>(null);
const recalling = ref(false);

watch(
  () => props.show,
  (val) => {
    if (val && props.recallTarget) {
      recallAmount.value = props.recallTarget.totalAmount;
      recallError.value = null;
      recalling.value = false;
    }
  },
);

// ── Actions ───────────────────────────────────────────────────────────────────

async function submit() {
  if (!props.recallTarget) return;
  const group = props.recallTarget;
  recalling.value = true;
  recallError.value = null;
  const headers = { 'x-station-id': props.stationId };
  try {
    if (recallAmount.value >= group.totalAmount) {
      for (const id of group.ids) {
        await apiClient.delete(`/asteroids/${props.asteroidId}/assignments/${id}`, { headers });
      }
    } else {
      await apiClient.put(
        `/asteroids/${props.asteroidId}/assignments/${group.ids[0]}`,
        { assignedAmount: group.totalAmount - recallAmount.value },
        { headers },
      );
    }
    emit('done');
  } catch (err: any) {
    recallError.value = err?.response?.data?.message ?? 'Recall failed';
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
      <div class="bg-[#060c1b] border border-red-400/20 rounded p-5 w-72 flex flex-col gap-4 font-mono">
        <!-- Header -->
        <div class="flex items-center justify-between">
          <span class="text-[10px] text-white/50 uppercase tracking-widest">Recall Miners</span>
          <button @click="emit('close')" class="text-white/30 hover:text-white/60 text-[11px]">✕</button>
        </div>

        <div v-if="recallTarget" class="flex flex-col gap-3">
          <div class="text-[10px] text-white/35">
            {{ recallTarget.spacecraftName }}
            <span class="text-white/20">— {{ recallTarget.totalAmount }} assigned</span>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-[9px] text-white/25 uppercase tracking-wider">Amount to Recall</label>
            <input
              v-model.number="recallAmount"
              type="number"
              :min="1"
              :max="recallTarget.totalAmount"
              class="bg-white/5 border border-white/10 rounded px-2 h-7 text-[11px] text-white/80 focus:outline-none focus:border-red-400/40 tabular-nums"
            />
          </div>

          <div v-if="recallError" class="text-[9px] text-red-400/80">{{ recallError }}</div>

          <button
            @click="submit"
            :disabled="recalling || recallAmount < 1"
            class="h-7 rounded text-[9px] uppercase tracking-widest bg-red-400/10 text-red-400/80 border border-red-400/25 hover:bg-red-400/15 hover:text-red-400 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {{ recalling ? 'Recalling…' : `Recall ${recallAmount}` }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>
