import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { useAuthStore } from './features/auth/index.js';
// Self-hosted: no request to Google, so no IP leaves for a third party.
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './style.css';

const app = createApp(App);

// Restore session BEFORE registering the router so the initial navigation
// guard already sees the correct isAuthenticated state.
const authStore = useAuthStore();
void authStore.restoreSession().finally(() => {
  app.use(router);
  app.mount('#app');
});
