import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '../features/auth/index.js';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    guestOnly?: boolean;
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Landing',
    component: () => import('../features/auth/index.js').then((m) => m.LandingView),
    meta: { guestOnly: true },
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../features/auth/index.js').then((m) => m.LoginView),
    meta: { guestOnly: true },
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('../features/auth/index.js').then((m) => m.RegisterView),
    meta: { guestOnly: true },
  },
  {
    path: '/map',
    name: 'Map',
    // The map chunk (Pixi) stays lazy; auth is in the main bundle anyway.
    component: () => import('../features/map/index.js').then((m) => m.MapView),
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
    return { name: 'Map' };
  }

  return true;
});
