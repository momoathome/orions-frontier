<script setup lang="ts">
import { reactive } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const authStore = useAuthStore();
// A message from the other auth view does not belong here.
authStore.error = null;
const form = reactive({ email: '', password: '' });
const errors = reactive<{ email?: string; password?: string }>({});

function validate(): boolean {
  errors.email = form.email ? undefined : 'Email is required.';
  errors.password = form.password ? undefined : 'Password is required.';
  return !errors.email && !errors.password;
}

async function submit() {
  if (!validate()) return;
  try {
    await authStore.login({ email: form.email, password: form.password });
    await router.push('/map');
  } catch {
    // The store holds the error message.
  } finally {
    form.password = '';
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-ui-bg p-4 text-ui-text">
    <form class="ui-card w-full max-w-sm gap-4 p-6" novalidate @submit.prevent="submit">
      <h1 class="text-lg font-semibold tracking-widest text-ui-cyan">Orion's Frontier</h1>
      <p v-if="authStore.error" class="ui-error">{{ authStore.error }}</p>
      <label class="flex flex-col gap-1.5">
        <span class="ui-label">Email</span>
        <input
          v-model="form.email"
          type="email"
          class="ui-input"
          :class="{ 'border-ui-red': errors.email }"
          required
          autofocus
          autocomplete="username"
          placeholder="pilot@example.com"
        />
        <span v-if="errors.email" class="text-xs text-ui-red">{{ errors.email }}</span>
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="ui-label">Password</span>
        <input
          v-model="form.password"
          type="password"
          class="ui-input"
          :class="{ 'border-ui-red': errors.password }"
          required
          autocomplete="current-password"
          placeholder="••••••••"
        />
        <span v-if="errors.password" class="text-xs text-ui-red">{{ errors.password }}</span>
      </label>
      <div class="flex items-center justify-between gap-4">
        <router-link to="/register" class="text-sm text-ui-muted underline hover:text-ui-text">
          Don't have an account?
        </router-link>
        <button type="submit" class="ui-btn ui-btn-primary" :disabled="authStore.isLoading">
          {{ authStore.isLoading ? 'Logging in…' : 'Log in' }}
        </button>
      </div>
    </form>
  </main>
</template>
