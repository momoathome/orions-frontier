import { computed, reactive } from 'vue';
import type { LogbookEntry } from '@orions-frontier/shared';
import { apiClient } from '../../shared/api/api-client.js';
import { guarded } from '../../shared/lib/live.js';
import { loadOlder, mergeById } from '../../shared/lib/paging.js';

const LOGBOOK_SEEN_KEY = 'logbook_seen_at';
const PAGE = 100;

const state = reactive<{ logbook: LogbookEntry[]; logbookSeenAt: number; allLoaded: boolean }>({
  logbook: [],
  logbookSeenAt: Number(localStorage.getItem(LOGBOOK_SEEN_KEY) ?? 0),
  allLoaded: false,
});

// A fresh first page goes in front of the older entries the player loaded.
const refreshLogbook = () =>
  guarded(async () => {
    const page = await apiClient.get<LogbookEntry[]>('/me/logbook', { params: { limit: PAGE } });
    state.logbook = mergeById(page, state.logbook);
  });

async function loadOlderLogbook(): Promise<void> {
  const { list, done } = await loadOlder('/me/logbook', state.logbook, PAGE);
  state.logbook = list;
  state.allLoaded = done;
}

const hasOlderLogbook = () => !state.allLoaded && state.logbook.length >= PAGE;

const unseenLogbook = computed(() =>
  state.logbook.filter((entry) => Date.parse(entry.occurredAt) > state.logbookSeenAt)
);

function markLogbookSeen(): void {
  state.logbookSeenAt = Date.now();
  localStorage.setItem(LOGBOOK_SEEN_KEY, String(state.logbookSeenAt));
}

const logbookStore = reactive({
  state,
  unseenLogbook,
  refreshLogbook,
  loadOlderLogbook,
  hasOlderLogbook,
  markLogbookSeen,
});

export const useLogbookStore = () => logbookStore;
