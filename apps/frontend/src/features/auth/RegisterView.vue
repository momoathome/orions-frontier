<script setup lang="ts">
import { reactive } from 'vue';
import { useRouter } from 'vue-router';
import AuthShell from './AuthShell.vue';
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
  <AuthShell
    title="Start your station"
    lead="Pick a pilot name. New players start with 24 h of protection from attacks."
  >
    <template #switch>
      <router-link to="/login" class="text-sm text-ui-soft transition-colors hover:text-ui-bright">
        Log in
      </router-link>
    </template>
    <form class="flex flex-col gap-5" @submit.prevent="submit">
      <label class="flex flex-col gap-1.5">
        <span class="text-[13px] text-ui-soft">Pilot name</span>
        <input
          v-model.trim="form.username"
          class="ui-input h-11"
          required
          minlength="3"
          maxlength="50"
          autocomplete="username"
        />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="text-[13px] text-ui-soft">Email</span>
        <input
          v-model.trim="form.email"
          type="email"
          class="ui-input h-11"
          required
          autocomplete="email"
        />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="text-[13px] text-ui-soft">Password</span>
        <input
          v-model="form.password"
          type="password"
          class="ui-input h-11"
          required
          minlength="12"
          maxlength="128"
          autocomplete="new-password"
          placeholder="At least 12 characters"
        />
      </label>
      <p v-if="authStore.error" class="ui-error">{{ authStore.error }}</p>
      <button
        type="submit"
        class="ui-btn ui-btn-cta mt-1 h-11 w-full text-[15px]"
        :disabled="authStore.isLoading"
      >
        {{ authStore.isLoading ? 'Creating…' : 'Create account' }}
      </button>
      <p class="text-sm text-ui-muted">
        Already playing?
        <router-link to="/login" class="text-ui-soft underline hover:text-ui-bright"
          >Log in</router-link
        >
      </p>
    </form>
  </AuthShell>
</template>
