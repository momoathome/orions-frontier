<template>
  <div class="dashboard">
    <h1>Dashboard</h1>
    <p>This is the main dashboard placeholder.</p>
    <p>Game features will be implemented in later phases.</p>
    
    <div class="nav">
      <router-link to="/">Back to Home</router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
// Dashboard logic will be implemented in later phases
</script>

<style scoped>
.dashboard {
  padding: 2rem;
}

h1 {
  font-size: 2.5rem;
  margin-bottom: 1rem;
}

.nav {
  margin-top: 2rem;
}

.nav a {
  color: #646cff;
  text-decoration: none;
}

.nav a:hover {
  text-decoration: underline;
}
</style>
