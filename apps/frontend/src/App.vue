<template>
  <div id="app">
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import { useAuthStore } from './stores/auth';
import { wsClient } from './lib/ws-client';

const authStore = useAuthStore();

// Connect (or reconnect) as soon as a token is available, regardless of route.
// Runs once on mount if already logged in, and again if the user logs in later.
watch(
  () => authStore.token,
  (token) => {
    if (token) wsClient.connect(token);
  },
  { immediate: true }
);
</script>

<style scoped>
#app {
  width: 100%;
  height: 100vh;
}
</style>
