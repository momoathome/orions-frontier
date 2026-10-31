<script setup lang="ts">
import { reactive } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from './store';

const router = useRouter();
const authStore = useAuthStore();
// A message from the other auth view does not belong here.
authStore.error = null;
const form = reactive({ username: '', email: '', password: '' });

async function submit() {
  try {
    await authStore.register(form);
    await router.push('/map');
  } catch {
    // The store holds the error message.
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-ui-bg p-4 text-ui-text">
    <form class="ui-card w-full max-w-sm gap-4 p-6" @submit.prevent="submit">
      <h1 class="text-lg font-semibold tracking-widest text-ui-cyan">Create pilot account</h1>
      <label class="flex flex-col gap-1.5">
        <span class="ui-label">Pilot name</span>
        <input
          v-model.trim="form.username"
          class="ui-input"
          required
          minlength="3"
          maxlength="50"
          autocomplete="username"
        />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="ui-label">Email</span>
        <input
          v-model.trim="form.email"
          type="email"
          class="ui-input"
          required
          autocomplete="email"
        />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="ui-label">Password</span>
        <input
          v-model="form.password"
          type="password"
          class="ui-input"
          required
          minlength="12"
          maxlength="128"
          autocomplete="new-password"
          placeholder="At least 12 characters"
        />
      </label>
      <p v-if="authStore.error" class="ui-error">{{ authStore.error }}</p>
      <button type="submit" class="ui-btn ui-btn-primary" :disabled="authStore.isLoading">
        {{ authStore.isLoading ? 'Creating…' : 'Register' }}
      </button>
      <router-link to="/login" class="text-center text-sm text-ui-muted hover:text-ui-text">
        Back to login
      </router-link>
    </form>
  </main>
</template>
