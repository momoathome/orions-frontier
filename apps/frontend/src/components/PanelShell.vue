<script setup lang="ts">
/** Right-hand detail panel over the map: eyebrow, title, close button, then the panel body. */
const { label, wide } = defineProps<{
  label: string;
  eyebrow?: string;
  title?: string;
  wide?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const slots = defineSlots<{
  eyebrow?: () => unknown;
  title?: () => unknown;
  /** Extra header content under the title, such as stats or tabs. */
  header?: () => unknown;
  default?: () => unknown;
}>();
</script>

<template>
  <aside
    class="flex h-full shrink-0 flex-col border-l border-ui-line bg-ui-panel text-left text-sm text-ui-text"
    :class="wide ? 'w-[440px]' : 'w-[400px]'"
    :aria-label="label"
  >
    <div
      class="flex flex-col gap-3 border-b border-ui-line px-[18px] pt-4"
      :class="slots.header ? 'pb-3' : 'pb-4'"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-1">
          <span class="ui-label"
            ><slot name="eyebrow">{{ eyebrow }}</slot></span
          >
          <h2 class="truncate text-xl font-semibold text-ui-bright">
            <slot name="title">{{ title }}</slot>
          </h2>
        </div>
        <button
          type="button"
          class="ui-btn ui-btn-icon"
          aria-label="Close panel"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>
      <slot name="header" />
    </div>
    <slot />
  </aside>
</template>
