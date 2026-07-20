import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { useAuthStore } from './stores/auth';
import './style.css';

const app = createApp(App);

// Restore session BEFORE registering the router so the initial navigation
// guard already sees the correct isAuthenticated state.
const authStore = useAuthStore();
authStore.restoreSession().finally(() => {
  app.use(router);
  app.mount('#app');
});
