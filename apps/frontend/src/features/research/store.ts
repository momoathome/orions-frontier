import { computed, reactive } from 'vue';
import { researchModifiers } from '@orions-frontier/game-config';
import type { ResearchKey, ResearchLevels, ResearchState } from '@orions-frontier/shared';
import { apiClient } from '../../shared/api/api-client.js';
import { wsClient } from '../../shared/api/ws-client.js';
import { debounced } from '../../shared/lib/debounce.js';

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

let researchRequest = 0;
async function refresh(): Promise<void> {
  const request = ++researchRequest;
  try {
    const research = await apiClient.get<ResearchState>('/me/research');
    if (request !== researchRequest) return;
    state.research = research;
    state.error = null;
  } catch {
    if (request === researchRequest) state.error = 'Research could not be loaded';
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

// Blockers follow building levels, and a lost station drops queued research server-side.
const scheduleRefresh = debounced(refresh, 500);

/** Loads account research and keeps it current through realtime events; no polling. */
function start(): () => void {
  void refresh();
  const unsubscribers = [
    wsClient.on('research_completed', () => void refresh()),
    wsClient.on('building_upgrade_completed', scheduleRefresh),
    wsClient.on('transport_tick_completed', scheduleRefresh),
    wsClient.onReconnected(() => void refresh()),
  ];
  return () => {
    scheduleRefresh.cancel();
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
  void refresh();
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
