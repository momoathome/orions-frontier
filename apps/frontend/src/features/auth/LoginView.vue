<script setup lang="ts">
import { reactive } from 'vue';
import { useRouter } from 'vue-router';
import AuthShell from './AuthShell.vue';
import { useAuthStore } from './store';

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
  <AuthShell title="Log in" lead="Your miners kept hauling while you were away. See what came in.">
    <template #switch>
      <router-link
        to="/register"
        class="text-sm text-ui-soft transition-colors hover:text-ui-bright"
      >
        Start your station
      </router-link>
    </template>
    <form class="flex flex-col gap-5" novalidate @submit.prevent="submit">
      <p v-if="authStore.error" class="ui-error">{{ authStore.error }}</p>
      <label class="flex flex-col gap-1.5">
        <span class="text-[13px] text-ui-soft">Email</span>
        <input
          v-model="form.email"
          type="email"
          class="ui-input h-11"
          :class="{ 'border-ui-red': errors.email }"
          required
          autofocus
          autocomplete="username"
          placeholder="pilot@example.com"
        />
        <span v-if="errors.email" class="text-xs text-ui-red">{{ errors.email }}</span>
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="text-[13px] text-ui-soft">Password</span>
        <input
          v-model="form.password"
          type="password"
          class="ui-input h-11"
          :class="{ 'border-ui-red': errors.password }"
          required
          autocomplete="current-password"
          placeholder="••••••••"
        />
        <span v-if="errors.password" class="text-xs text-ui-red">{{ errors.password }}</span>
      </label>
      <button
        type="submit"
        class="ui-btn ui-btn-cta mt-1 h-11 w-full text-[15px]"
        :disabled="authStore.isLoading"
      >
        {{ authStore.isLoading ? 'Logging in…' : 'Log in' }}
      </button>
      <p class="text-sm text-ui-muted">
        New to the Belt?
        <router-link to="/register" class="text-ui-soft underline hover:text-ui-bright">
          Start your station
        </router-link>
      </p>
    </form>
  </AuthShell>
</template>
