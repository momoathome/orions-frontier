<script setup lang="ts">
import type { RequirementBlocker } from '@orions-frontier/shared';
import { formatBlocker } from '../lib/format';
import { useResearchStore } from '../stores/research.js';

const { blockers } = defineProps<{ blockers: readonly RequirementBlocker[] }>();
const research = useResearchStore();
</script>

<template>
  <ul class="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Missing requirements">
    <li v-for="blocker in blockers" :key="formatBlocker(blocker)">
      <!-- A research chip opens the research view at that node. -->
      <button
        v-if="blocker.type === 'research'"
        type="button"
        class="rounded border border-[#1f5b66] bg-[#0c2026] px-2 py-0.5 text-ui-cyan transition hover:border-ui-cyan"
        :title="`Open ${formatBlocker(blocker)} in research`"
        @click.stop="research.openView(blocker.key)"
      >
        <span aria-hidden="true">🔒</span> {{ formatBlocker(blocker) }}
      </button>
      <span v-else class="rounded border border-ui-line-strong px-2 py-0.5 text-ui-soft">
        <span aria-hidden="true">🔒</span> {{ formatBlocker(blocker) }}
      </span>
    </li>
  </ul>
</template>
