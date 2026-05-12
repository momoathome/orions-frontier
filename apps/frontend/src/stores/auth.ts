import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { User } from '@orions-frontier/types';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const token = ref<string | null>(null);
  const isAuthenticated = ref(false);

  const login = async (email: string, password: string) => {
    // TODO: Implement login logic
    console.log('Login:', email, password);
  };

  const logout = () => {
    user.value = null;
    token.value = null;
    isAuthenticated.value = false;
    localStorage.removeItem('auth_token');
  };

  const checkAuth = () => {
    const storedToken = localStorage.getItem('auth_token');
    if (storedToken) {
      token.value = storedToken;
      // TODO: Validate token and fetch user
    }
  };

  return {
    user,
    token,
    isAuthenticated,
    login,
    logout,
    checkAuth,
  };
});
