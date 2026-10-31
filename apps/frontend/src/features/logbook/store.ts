import { computed, reactive } from 'vue';
import type { LogbookEntry } from '@orions-frontier/shared';
import { apiClient } from '../../shared/api/api-client.js';
import { guarded } from '../../shared/lib/live.js';
import { loadOlder, mergeById } from '../../shared/lib/paging.js';
import { useAuthStore } from '../auth/index.js';

const auth = useAuthStore();
// Per account, so a second login in this browser starts with its own unread entries.
const seenKey = () => `logbook_seen_at:${auth.user?.id ?? ''}`;
const PAGE = 100;

const state = reactive<{ logbook: LogbookEntry[]; logbookSeenAt: number; allLoaded: boolean }>({
  logbook: [],
  logbookSeenAt: 0,
  allLoaded: false,
});

// A fresh first page goes in front of the older entries the player loaded.
const refreshLogbook = () =>
  guarded(async () => {
    const page = await apiClient.get<LogbookEntry[]>('/me/logbook', { params: { limit: PAGE } });
    state.logbookSeenAt = Number(localStorage.getItem(seenKey()) ?? 0);
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

/** Stores the newest server timestamp, not the browser clock, which may be off. */
function markLogbookSeen(): void {
  state.logbookSeenAt = Math.max(
    state.logbookSeenAt,
    ...state.logbook.map((entry) => Date.parse(entry.occurredAt))
  );
  localStorage.setItem(seenKey(), String(state.logbookSeenAt));
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
