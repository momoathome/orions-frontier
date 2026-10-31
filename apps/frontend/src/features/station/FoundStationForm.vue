<script setup lang="ts">
import { ref } from 'vue';
import { apiClient, apiErrorMessage } from '../../shared/api/api-client';

const name = ref('Frontier Station');
const error = ref<string | null>(null);
const creating = ref(false);

async function create() {
  creating.value = true;
  error.value = null;
  try {
    await apiClient.post('/stations', { name: name.value });
    // The map boots from the station list; a fresh start is the simplest way in.
    window.location.reload();
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Station creation failed');
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div class="absolute inset-0 z-30 flex items-center justify-center bg-ui-bg p-4">
    <form class="ui-card w-full max-w-sm gap-4 p-6" @submit.prevent="create">
      <h1 class="text-xl font-semibold text-ui-bright">Found your first station</h1>
      <p class="text-ui-soft">Choose a name for your foothold in the frontier.</p>
      <input
        v-model.trim="name"
        required
        maxlength="128"
        aria-label="Station name"
        class="ui-input"
      />
      <p v-if="error" class="text-ui-red">{{ error }}</p>
      <button type="submit" :disabled="creating" class="ui-btn ui-btn-primary">
        {{ creating ? 'Founding…' : 'Found station' }}
      </button>
    </form>
  </div>
</template>
