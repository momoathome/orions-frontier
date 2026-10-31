<script setup lang="ts">
import { watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth';
import { wsClient } from './lib/ws-client';

const authStore = useAuthStore();
const router = useRouter();

// Connect (or reconnect) as soon as a token is available, regardless of route.
// Runs once on mount if already logged in, and again if the user logs in later.
// Logout and an expired session (HTTP 401, WS 4401) clear the token and leave the game.
watch(
  () => authStore.token,
  (token) => {
    if (token) {
      wsClient.connect(token);
      return;
    }
    wsClient.disconnect();
    if (router.currentRoute.value.meta.requiresAuth) void router.push({ name: 'Login' });
  },
  { immediate: true }
);
</script>

<template>
  <div id="app">
    <router-view />
  </div>
</template>

<style scoped>
#app {
  width: 100%;
  height: 100vh;
}
</style>
