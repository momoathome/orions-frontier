<script setup lang="ts">
import Wordmark from './Wordmark.vue';

defineProps<{ title: string; lead: string }>();
defineSlots<{ default(): unknown; switch(): unknown }>();
</script>

<template>
  <div class="flex min-h-screen flex-col bg-ui-bg text-left text-ui-text">
    <header class="flex h-16 shrink-0 items-center justify-between px-6">
      <router-link to="/" class="text-[15px]"><Wordmark /></router-link>
      <slot name="switch" />
    </header>

    <div class="grid flex-1 gap-2 px-6 pb-6 md:grid-cols-2">
      <main class="flex items-center justify-center py-12">
        <div class="enter w-full max-w-sm">
          <h1 class="text-[32px] leading-tight font-medium tracking-[-0.01em] text-ui-bright">
            {{ title }}
          </h1>
          <p class="mt-3 text-[15px] text-ui-soft">{{ lead }}</p>
          <div class="mt-8"><slot /></div>
        </div>
      </main>

      <img
        src="/assets/spacecrafts/mole.webp"
        alt="A Mole mining ship cutting into an asteroid with an orange beam"
        width="3641"
        height="2048"
        class="hidden h-full min-h-0 w-full rounded-2xl border border-ui-line object-cover object-[35%_center] md:block"
      />
    </div>
  </div>
</template>

<style scoped>
.enter {
  animation: enter 400ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .enter {
    animation: none;
  }
}
</style>
