import { reactive } from 'vue';
import type { Ranking } from '@orions-frontier/shared';
import { apiClient } from '../../shared/api/api-client.js';
import { guarded } from '../../shared/lib/live.js';

/** The ranking scans every station on the server; ticks reuse it for a minute. */
const MAX_AGE_MS = 60_000;

const state = reactive<{ ranking: Ranking | null }>({ ranking: null });
let loadedAt = 0;

/** `force` reloads even a fresh ranking, e.g. when the player opens it. */
const refreshRanking = (force = false) =>
  !force && Date.now() - loadedAt < MAX_AGE_MS
    ? Promise.resolve()
    : guarded(async () => {
        state.ranking = await apiClient.get<Ranking>('/world/ranking', { params: { limit: 20 } });
        loadedAt = Date.now();
      });

const rankingStore = reactive({ state, refreshRanking });

export const useRankingStore = () => rankingStore;
