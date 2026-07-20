<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const authStore = useAuthStore();
const form = reactive({ username: '', email: '', password: '' });
const submitting = ref(false);
const error = ref<string | null>(null);

async function submit() {
  submitting.value = true;
  error.value = null;
  try {
    await authStore.register(form);
    await router.push('/map');
  } catch {
    error.value = authStore.error ?? 'Registration failed';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="min-h-screen bg-[#070b14] text-white flex items-center justify-center p-4">
    <form
      class="w-full max-w-sm rounded border border-cyan-500/20 bg-[#0a1120] p-6 flex flex-col gap-4"
      @submit.prevent="submit"
    >
      <h1 class="text-lg tracking-widest text-cyan-200">Create pilot account</h1>
      <input
        v-model.trim="form.username"
        required
        minlength="3"
        maxlength="50"
        autocomplete="username"
        placeholder="Pilot name"
        class="rounded border border-white/10 bg-white/5 px-3 py-2"
      />
      <input
        v-model.trim="form.email"
        required
        type="email"
        autocomplete="email"
        placeholder="Email"
        class="rounded border border-white/10 bg-white/5 px-3 py-2"
      />
      <input
        v-model="form.password"
        required
        minlength="8"
        maxlength="128"
        type="password"
        autocomplete="new-password"
        placeholder="Password"
        class="rounded border border-white/10 bg-white/5 px-3 py-2"
      />
      <p v-if="error" class="text-sm text-red-300">{{ error }}</p>
      <button
        type="submit"
        :disabled="submitting"
        class="rounded border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-cyan-200 disabled:opacity-50"
      >
        {{ submitting ? 'Creating…' : 'Register' }}
      </button>
      <router-link to="/login" class="text-center text-sm text-white/50 hover:text-white/80">
        Back to login
      </router-link>
    </form>
  </main>
</template>
