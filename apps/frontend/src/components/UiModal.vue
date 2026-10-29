<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';

const { title, eyebrow, wide } = defineProps<{ title: string; eyebrow?: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
defineSlots<{ default(): unknown }>();

const onKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') emit('close');
};
onMounted(() => {
  window.addEventListener('keydown', onKey);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-[#02050b]/70 p-4 backdrop-blur-sm"
      @click.self="emit('close')"
    >
      <section
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        class="flex max-h-[85vh] w-full flex-col rounded-xl border border-ui-line-strong bg-ui-panel text-left text-sm text-ui-text shadow-2xl shadow-black/50"
        :class="wide ? 'max-w-[720px]' : 'max-w-[520px]'"
      >
        <header class="flex items-start justify-between gap-4 border-b border-ui-line px-5 py-4">
          <div class="flex flex-col gap-1">
            <span v-if="eyebrow" class="ui-label">{{ eyebrow }}</span>
            <h2 class="text-xl font-semibold text-ui-bright">{{ title }}</h2>
          </div>
          <button
            type="button"
            class="ui-btn ui-btn-icon"
            aria-label="Close"
            @click="emit('close')"
          >
            ✕
          </button>
        </header>
        <div class="flex-1 overflow-y-auto px-5 py-4">
          <slot />
        </div>
      </section>
    </div>
  </Teleport>
</template>
