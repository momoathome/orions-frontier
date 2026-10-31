<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';

// `full` is for content that needs the whole screen, like the research graph; it brings no padding.
const { title, eyebrow, wide, full } = defineProps<{
  title: string;
  eyebrow?: string;
  wide?: boolean;
  full?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
defineSlots<{ default(): unknown }>();
const sectionClass = computed(() => {
  if (full) return 'h-full sm:h-[92vh] sm:max-w-[1440px] sm:rounded-xl';
  return ['max-h-[85vh] rounded-xl', wide ? 'max-w-[720px]' : 'max-w-[520px]'];
});

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
      class="fixed inset-0 z-50 flex items-center justify-center bg-[#02050b]/70 backdrop-blur-sm"
      :class="full ? 'sm:p-4' : 'p-4'"
      @click.self="emit('close')"
    >
      <section
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        class="flex w-full flex-col border border-ui-line-strong bg-ui-panel text-left text-sm text-ui-text shadow-2xl shadow-black/50"
        :class="sectionClass"
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
        <div class="min-h-0 flex-1" :class="full ? 'overflow-hidden' : 'overflow-y-auto px-5 py-4'">
          <slot />
        </div>
      </section>
    </div>
  </Teleport>
</template>
