import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  AuthenticatedUser,
  RegisterRequest,
  LoginRequest,
  AuthResponse,
} from '@orions-frontier/shared';
import { apiClient } from '../lib/api-client.js';

const TOKEN_KEY = 'auth_token';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthenticatedUser | null>(null);
  const token = ref<string | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => token.value !== null && user.value !== null);

  const _setSession = (response: AuthResponse) => {
    token.value = response.token;
    user.value = response.user;
    localStorage.setItem(TOKEN_KEY, response.token);
  };

  const _clearSession = () => {
    token.value = null;
    user.value = null;
    localStorage.removeItem(TOKEN_KEY);
  };

  const login = async (credentials: LoginRequest): Promise<void> => {
    isLoading.value = true;
    error.value = null;
    try {
      const { data } = await apiClient.post<{ success: true; data: AuthResponse }>(
        '/auth/login',
        credentials
      );
      _setSession(data.data);
    } catch (err: unknown) {
      error.value = extractErrorMessage(err);
      throw err;
    } finally {
      isLoading.value = false;
    }
  };

  const register = async (payload: RegisterRequest): Promise<void> => {
    isLoading.value = true;
    error.value = null;
    try {
      const { data } = await apiClient.post<{ success: true; data: AuthResponse }>(
        '/auth/register',
        payload
      );
      _setSession(data.data);
    } catch (err: unknown) {
      error.value = extractErrorMessage(err);
      throw err;
    } finally {
      isLoading.value = false;
    }
  };

  const logout = () => {
    _clearSession();
  };

  const restoreSession = async (): Promise<void> => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) return;

    token.value = storedToken;
    isLoading.value = true;
    try {
      const { data } = await apiClient.get<{ success: true; data: AuthenticatedUser }>('/auth/me');
      user.value = data.data;
    } catch {
      _clearSession();
    } finally {
      isLoading.value = false;
    }
  };

  return {
    user,
    token,
    isAuthenticated,
    isLoading,
    error,
    login,
    register,
    logout,
    restoreSession,
  };
});

const extractErrorMessage = (err: unknown): string => {
  if (
    err &&
    typeof err === 'object' &&
    'response' in err &&
    err.response &&
    typeof err.response === 'object' &&
    'data' in err.response
  ) {
    const data = (err.response as { data?: { error?: { message?: string } } }).data;
    return data?.error?.message ?? 'An unexpected error occurred';
  }
  return 'An unexpected error occurred';
};
