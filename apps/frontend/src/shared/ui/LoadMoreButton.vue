<script setup lang="ts">
import { ref } from 'vue';

// Shows itself while older entries may exist; `load` resolves once the next page is in.
const { load } = defineProps<{ load: () => Promise<unknown> }>();
const busy = ref(false);
const failed = ref(false);

async function click() {
  busy.value = true;
  failed.value = false;
  try {
    await load();
  } catch {
    failed.value = true;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <button type="button" class="ui-btn h-8 self-center px-3 text-xs" :disabled="busy" @click="click">
    {{ busy ? 'Loading…' : 'Load more' }}
  </button>
  <p v-if="failed" class="ui-error self-center">Could not load, retry</p>
</template>
