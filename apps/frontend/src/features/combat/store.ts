import { reactive } from 'vue';
import type { CombatReport } from '@orions-frontier/shared';
import { apiClient } from '../../shared/api/api-client.js';
import { guarded } from '../../shared/lib/live.js';

/** Combat reports of the account, attacks sent and received; the overview keeps them current. */
const state = reactive<{ combats: CombatReport[] }>({ combats: [] });

const refreshCombats = () =>
  guarded(async () => (state.combats = await apiClient.get<CombatReport[]>('/me/combats')));

const combatStore = reactive({ state, refreshCombats });

export const useCombatStore = () => combatStore;
