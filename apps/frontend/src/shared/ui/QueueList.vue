<script setup lang="ts">
import {
  getBuilding,
  getDefenseUpgrade,
  getResearchDefinition,
} from '@orions-frontier/game-config';
import {
  QUEUE_LIMIT,
  buildingKeys,
  defenseUpgradeKeys,
  isOneOf,
  type QueuedJob,
} from '@orions-frontier/shared';
import ConfirmCancelButton from './ConfirmCancelButton.vue';

// Waiting jobs in start order; each one is already paid and can be removed for a refund.
const { jobs, busyId } = defineProps<{ jobs: QueuedJob[]; busyId: string | null }>();
const emit = defineEmits<{ remove: [jobId: string] }>();

const jobName = (job: QueuedJob) =>
  job.kind === 'research'
    ? (getResearchDefinition(job.key)?.name ?? job.key)
    : isOneOf(buildingKeys, job.key)
      ? getBuilding(job.key).name
      : isOneOf(defenseUpgradeKeys, job.key)
        ? getDefenseUpgrade(job.key).name
        : job.key;
</script>

<template>
  <div v-if="jobs.length > 0" class="flex flex-col gap-1">
    <span class="ui-label"
      >Queue
      <span class="ui-num normal-case tracking-normal text-ui-dim"
        >{{ jobs.length }} / {{ QUEUE_LIMIT }}</span
      ></span
    >
    <ol class="flex flex-col gap-1">
      <li
        v-for="job in jobs"
        :key="job.id"
        class="flex items-center justify-between gap-2 rounded-md border border-ui-line px-2.5 py-1 text-[13px]"
      >
        <span class="text-ui-text"
          >{{ jobName(job) }}
          <span class="ui-num text-ui-muted">Lv. {{ job.targetLevel }}</span></span
        >
        <ConfirmCancelButton :busy="busyId === job.id" @confirm="emit('remove', job.id)" />
      </li>
    </ol>
  </div>
</template>
