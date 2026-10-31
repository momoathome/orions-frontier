<script setup lang="ts">
import { computed, ref } from 'vue';
import { apiClient, apiErrorMessage } from '../../shared/api/api-client';
import { useStationStore } from './store.js';
import QueueList from '../../shared/ui/QueueList.vue';

const { stationId } = defineProps<{ stationId: string }>();
const emit = defineEmits<{ changed: [] }>();
const stationStore = useStationStore();
const slots = computed(() => stationStore.state.details[stationId]?.buildSlots ?? null);
const full = computed(() => slots.value !== null && slots.value.used >= slots.value.total);
const removing = ref<string | null>(null);
const error = ref<string | null>(null);

async function remove(jobId: string) {
  removing.value = jobId;
  error.value = null;
  try {
    await apiClient.delete(`/stations/${stationId}/queue/${jobId}`);
    await stationStore.refreshStation(stationId);
    emit('changed');
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Queue entry could not be removed');
  } finally {
    removing.value = null;
  }
}
</script>

<template>
  <!-- Building and defense upgrades share these slots; Parallel Construction adds more. -->
  <div v-if="slots" class="flex flex-col gap-1">
    <div class="flex items-center justify-between gap-3">
      <span class="ui-label">Build slots</span>
      <span class="flex items-center gap-2">
        <span class="flex gap-1" aria-hidden="true">
          <span
            v-for="slot in slots.total"
            :key="slot"
            class="h-2.5 w-4 rounded-sm border"
            :class="
              slot <= slots.used
                ? 'border-ui-amber bg-ui-amber/70'
                : 'border-ui-line-strong bg-transparent'
            "
          />
        </span>
        <span class="ui-num text-[13px]" :class="full ? 'text-ui-amber' : 'text-ui-soft'"
          >{{ slots.used }} / {{ slots.total }} in use</span
        >
      </span>
    </div>
    <span v-if="full" class="text-xs text-ui-muted"
      >All slots busy. New upgrades wait in the queue; Parallel Construction adds slots.</span
    >
    <QueueList :jobs="slots.queue" :busy-id="removing" @remove="remove" />
    <p v-if="error" class="text-xs text-ui-red">{{ error }}</p>
  </div>
</template>
