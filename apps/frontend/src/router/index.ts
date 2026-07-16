import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '../stores/auth';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    guestOnly?: boolean;
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/login',
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/LoginView.vue'),
    meta: { guestOnly: true },
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('../views/HomeView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/map',
    name: 'Map',
    component: () => import('../views/MapView.vue'),
    meta: { requiresAuth: true },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const authStore = useAuthStore();

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return { name: 'Login' };
  }

  if (to.meta.guestOnly && authStore.isAuthenticated) {
    return { name: 'Dashboard' };
  }

  return true;
});
