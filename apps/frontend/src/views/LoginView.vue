<template>
  <div class="auth-wrapper">
    <div class="auth-card">
      <h1 class="auth-title">Orion's Frontier</h1>

      <p v-if="errorMessage" class="form-error-banner">{{ errorMessage }}</p>

      <form @submit.prevent="submit" novalidate>
        <div class="form-group">
          <label for="email" class="form-label">Email</label>
          <input
            id="email"
            v-model="form.email"
            type="email"
            class="form-input"
            :class="{ 'form-input--error': errors.email }"
            required
            autofocus
            autocomplete="username"
            placeholder="pilot@example.com"
          />
          <span v-if="errors.email" class="form-field-error">{{ errors.email }}</span>
        </div>

        <div class="form-group">
          <label for="password" class="form-label">Password</label>
          <input
            id="password"
            v-model="form.password"
            type="password"
            class="form-input"
            :class="{ 'form-input--error': errors.password }"
            required
            autocomplete="current-password"
            placeholder="••••••••"
          />
          <span v-if="errors.password" class="form-field-error">{{ errors.password }}</span>
        </div>

        <div class="form-actions">
          <router-link to="/register" class="link">Don't have an account?</router-link>
          <button type="submit" class="btn-primary" :disabled="loading">
            {{ loading ? 'Logging in…' : 'Log in' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const authStore = useAuthStore();

const form = reactive({
  email: '',
  password: '',
});

const errors = reactive<{ email?: string; password?: string }>({});
const errorMessage = ref('');
const loading = ref(false);

const validate = (): boolean => {
  errors.email = undefined;
  errors.password = undefined;

  if (!form.email) {
    errors.email = 'Email is required.';
  }
  if (!form.password) {
    errors.password = 'Password is required.';
  }

  return !errors.email && !errors.password;
};

const submit = async () => {
  if (!validate()) return;

  errorMessage.value = '';
  loading.value = true;

  try {
    await authStore.login({ email: form.email, password: form.password });
    router.push('/map');
  } catch {
    errorMessage.value = authStore.error ?? 'Login failed. Please check your credentials.';
  } finally {
    loading.value = false;
    form.password = '';
  }
};
</script>

<style scoped>
.auth-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 1rem;
  background-color: #1a1a2e;
}

.auth-card {
  width: 100%;
  max-width: 420px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 2.5rem 2rem;
}

.auth-title {
  font-size: 1.75rem;
  font-weight: 600;
  color: #646cff;
  text-align: center;
  margin-bottom: 2rem;
  letter-spacing: 0.02em;
}

.form-group {
  margin-bottom: 1.25rem;
}

.form-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 0.375rem;
}

.form-input {
  width: 100%;
  padding: 0.625rem 0.875rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.9375rem;
  outline: none;
  transition: border-color 0.2s;
}

.form-input:focus {
  border-color: #646cff;
}

.form-input--error {
  border-color: #ff6b6b;
}

.form-field-error {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.8rem;
  color: #ff6b6b;
}

.form-error-banner {
  margin-bottom: 1.25rem;
  padding: 0.75rem 1rem;
  background: rgba(255, 107, 107, 0.1);
  border: 1px solid rgba(255, 107, 107, 0.3);
  border-radius: 6px;
  font-size: 0.875rem;
  color: #ff6b6b;
}

.form-remember {
  margin-bottom: 1.5rem;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
}

.checkbox {
  width: 1rem;
  height: 1rem;
  accent-color: #646cff;
  cursor: pointer;
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.link {
  font-size: 0.8125rem;
  color: rgba(255, 255, 255, 0.5);
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: color 0.2s;
}

.link:hover {
  color: rgba(255, 255, 255, 0.8);
}

.btn-primary {
  padding: 0.625rem 1.5rem;
  background: #646cff;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 0.2s,
    opacity 0.2s;
}

.btn-primary:hover:not(:disabled) {
  background: #535bf2;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
