<template>
  <div class="home">
    <h1>Orion's Frontier</h1>
    <p>Welcome to the new TypeScript infrastructure</p>
    
    <div class="info">
      <h2>System Status</h2>
      <div v-if="healthLoading">Loading...</div>
      <div v-else-if="healthError" class="error">
        Error: {{ healthError }}
      </div>
      <div v-else-if="health" class="status">
        <p>Status: <strong>{{ health.status }}</strong></p>
        <p>Database: <strong>{{ health.services.database }}</strong></p>
        <p>Redis: <strong>{{ health.services.redis }}</strong></p>
        <p>Timestamp: {{ new Date(health.timestamp).toLocaleString() }}</p>
      </div>
    </div>

    <div class="actions">
      <router-link to="/dashboard">Go to Dashboard</router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { apiClient } from '../lib/api-client';

interface HealthResponse {
  status: string;
  timestamp: string;
  services: {
    database: string;
    redis: string;
  };
}

const health = ref<HealthResponse | null>(null);
const healthLoading = ref(false);
const healthError = ref<string | null>(null);

const fetchHealth = async () => {
  healthLoading.value = true;
  healthError.value = null;
  
  try {
    const response = await apiClient.get<HealthResponse>('/health');
    health.value = response.data;
  } catch (err) {
    healthError.value = err instanceof Error ? err.message : 'Unknown error';
  } finally {
    healthLoading.value = false;
  }
};

onMounted(() => {
  fetchHealth();
});
</script>

<style scoped>
.home {
  padding: 2rem;
  max-width: 800px;
  margin: 0 auto;
}

h1 {
  font-size: 3rem;
  margin-bottom: 1rem;
  color: #646cff;
}

.info {
  margin: 2rem 0;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.status p {
  margin: 0.5rem 0;
  text-align: left;
}

.error {
  color: #ff6b6b;
}

.actions {
  margin-top: 2rem;
}

.actions a {
  display: inline-block;
  padding: 0.75rem 1.5rem;
  background: #646cff;
  color: white;
  text-decoration: none;
  border-radius: 4px;
  transition: background 0.3s;
}

.actions a:hover {
  background: #535bf2;
}
</style>
