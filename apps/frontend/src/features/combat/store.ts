import { reactive } from 'vue';
import type { CombatReport } from '@orions-frontier/shared';
import { apiClient } from '../../shared/api/api-client.js';
import { guarded } from '../../shared/lib/live.js';
import { loadOlder, mergeById } from '../../shared/lib/paging.js';

const PAGE = 100;

/** Combat reports of the account, attacks sent and received; the overview keeps them current. */
const state = reactive<{ combats: CombatReport[]; allLoaded: boolean }>({
  combats: [],
  allLoaded: false,
});

// A fresh first page goes in front of the older reports the player loaded.
const refreshCombats = () =>
  guarded(async () => {
    const page = await apiClient.get<CombatReport[]>('/me/combats', { params: { limit: PAGE } });
    state.combats = mergeById(page, state.combats);
  });

async function loadOlderCombats(): Promise<void> {
  const { list, done } = await loadOlder('/me/combats', state.combats, PAGE);
  state.combats = list;
  state.allLoaded = done;
}

const hasOlderCombats = () => !state.allLoaded && state.combats.length >= PAGE;

const combatStore = reactive({ state, refreshCombats, loadOlderCombats, hasOlderCombats });

export const useCombatStore = () => combatStore;
