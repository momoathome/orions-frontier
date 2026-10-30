<script setup lang="ts">
import { ref } from 'vue';

// A running job blocks a slot, so cancelling is easy to reach but asks once before it refunds.
const { busy } = defineProps<{ busy?: boolean }>();
const emit = defineEmits<{ confirm: [] }>();
const asking = ref(false);

function confirm() {
  asking.value = false;
  emit('confirm');
}
</script>

<template>
  <span v-if="asking" class="flex items-center gap-2" role="group" aria-label="Confirm cancel">
    <span class="text-xs text-ui-soft" title="Costs return to the station, limited by free storage."
      >Cancel and refund?</span
    >
    <button
      type="button"
      class="ui-btn ui-btn-danger h-8 px-3 text-xs"
      :disabled="busy"
      @click.stop="confirm"
    >
      Yes, cancel
    </button>
    <button type="button" class="ui-btn h-8 px-3 text-xs" @click.stop="asking = false">Keep</button>
  </span>
  <button
    v-else
    type="button"
    class="ui-btn h-8 px-3 text-xs"
    :disabled="busy"
    @click.stop="asking = true"
  >
    {{ busy ? 'Cancelling…' : 'Cancel' }}
  </button>
</template>
