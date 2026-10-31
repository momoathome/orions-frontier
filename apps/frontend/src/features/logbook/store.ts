import { computed, reactive } from 'vue';
import type { LogbookEntry } from '@orions-frontier/shared';
import { apiClient } from '../../shared/api/api-client.js';
import { guarded } from '../../shared/lib/live.js';

const LOGBOOK_SEEN_KEY = 'logbook_seen_at';

const state = reactive<{ logbook: LogbookEntry[]; logbookSeenAt: number }>({
  logbook: [],
  logbookSeenAt: Number(localStorage.getItem(LOGBOOK_SEEN_KEY) ?? 0),
});

const refreshLogbook = () =>
  guarded(
    async () =>
      (state.logbook = await apiClient.get<LogbookEntry[]>('/me/logbook', {
        params: { limit: 100 },
      }))
  );

const unseenLogbook = computed(() =>
  state.logbook.filter((entry) => Date.parse(entry.occurredAt) > state.logbookSeenAt)
);

function markLogbookSeen(): void {
  state.logbookSeenAt = Date.now();
  localStorage.setItem(LOGBOOK_SEEN_KEY, String(state.logbookSeenAt));
}

const logbookStore = reactive({ state, unseenLogbook, refreshLogbook, markLogbookSeen });

export const useLogbookStore = () => logbookStore;
