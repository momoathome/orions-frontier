import { computed, reactive } from 'vue';
import { researchModifiers } from '@orions-frontier/game-config';
import type { ResearchKey, ResearchLevels, ResearchState } from '@orions-frontier/shared';
import { apiClient } from '../../shared/api/api-client.js';
import { wsClient } from '../../shared/api/ws-client.js';

interface ResearchStoreState {
  research: ResearchState | null;
  error: string | null;
  /** The research view is open; `focus` is the node it centres on. */
  viewOpen: boolean;
  focus: string | null;
}

const state = reactive<ResearchStoreState>({
  research: null,
  error: null,
  viewOpen: false,
  focus: null,
});

async function refresh(): Promise<void> {
  try {
    state.research = await apiClient.get<ResearchState>('/me/research');
    state.error = null;
  } catch {
    state.error = 'Research could not be loaded';
  }
}

const levels = computed<ResearchLevels>(() =>
  Object.fromEntries(
    (state.research?.technologies ?? []).map((tech) => [tech.definition.key, tech.level])
  )
);
const modifiers = computed(() => researchModifiers(levels.value));
/** Research under way, soonest first; the server clears `completesAt` on completion. */
const running = computed(() =>
  (state.research?.technologies ?? [])
    .filter((tech) => tech.completesAt !== null)
    .sort((a, b) => Date.parse(a.completesAt ?? '') - Date.parse(b.completesAt ?? ''))
);

/** Loads account research and keeps it current through `research_completed`; no polling. */
function start(): () => void {
  void refresh();
  const unsubscribers = [
    wsClient.on('research_completed', () => void refresh()),
    wsClient.onReconnected(() => void refresh()),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

// The paying station gets `resources_updated` from the server, so only research reloads here.
async function startResearch(key: ResearchKey, stationId: string): Promise<void> {
  await apiClient.post(`/me/research/${key}`, { stationId });
  await refresh();
}

async function cancelResearch(key: ResearchKey): Promise<void> {
  await apiClient.delete(`/me/research/${key}`);
  await refresh();
}

/** Removes a waiting entry; later entries that needed its level go too, all refunded as far as storage allows. */
async function removeQueued(jobId: string): Promise<void> {
  await apiClient.delete(`/me/research/queue/${jobId}`);
  await refresh();
}

function openView(focus: string | null = null): void {
  state.focus = focus;
  state.viewOpen = true;
}

function closeView(): void {
  state.viewOpen = false;
}

const researchStore = reactive({
  state,
  levels,
  modifiers,
  running,
  start,
  startResearch,
  cancelResearch,
  removeQueued,
  openView,
  closeView,
});

export const useResearchStore = () => researchStore;
