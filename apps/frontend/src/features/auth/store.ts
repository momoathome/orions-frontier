import { computed, reactive, ref } from 'vue';
import type {
  AuthenticatedUser,
  RegisterRequest,
  LoginRequest,
  AuthResponse,
} from '@orions-frontier/shared';
import {
  apiClient,
  apiErrorMessage,
  onSessionExpired,
  setAuthToken,
} from '../../shared/api/api-client.js';

const TOKEN_KEY = 'auth_token';
const user = ref<AuthenticatedUser | null>(null);
const token = ref<string | null>(null);
const isLoading = ref(false);
const error = ref<string | null>(null);
const isAuthenticated = computed(() => token.value !== null && user.value !== null);

function setToken(value: string | null) {
  token.value = value;
  setAuthToken(value);
}

function setSession(response: AuthResponse) {
  setToken(response.token);
  user.value = response.user;
  localStorage.setItem(TOKEN_KEY, response.token);
}

function clearSession() {
  setToken(null);
  user.value = null;
  localStorage.removeItem(TOKEN_KEY);
}
// App.vue sends the player to the login once the token is gone.
onSessionExpired(clearSession);

async function submit(path: string, payload: LoginRequest | RegisterRequest) {
  isLoading.value = true;
  error.value = null;
  try {
    setSession(await apiClient.post<AuthResponse>(path, payload));
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'An unexpected error occurred');
    throw cause;
  } finally {
    isLoading.value = false;
  }
}

async function restoreSession() {
  const storedToken = localStorage.getItem(TOKEN_KEY);
  if (!storedToken) return;

  setToken(storedToken);
  isLoading.value = true;
  try {
    user.value = await apiClient.get<AuthenticatedUser>('/auth/me');
  } catch {
    // A 401 already ended the session; on a network error the stored token stays for the next load.
    setToken(null);
  } finally {
    isLoading.value = false;
  }
}

const authStore = reactive({
  user,
  token,
  isAuthenticated,
  isLoading,
  error,
  login: (credentials: LoginRequest) => submit('/auth/login', credentials),
  register: (payload: RegisterRequest) => submit('/auth/register', payload),
  logout: clearSession,
  restoreSession,
});

export const useAuthStore = () => authStore;
