import { reactive } from 'vue';
import type { Ranking } from '@orions-frontier/shared';
import { apiClient } from '../../shared/api/api-client.js';
import { guarded } from '../../shared/lib/live.js';

const state = reactive<{ ranking: Ranking | null }>({ ranking: null });

const refreshRanking = () =>
  guarded(
    async () =>
      (state.ranking = await apiClient.get<Ranking>('/world/ranking', { params: { limit: 20 } }))
  );

const rankingStore = reactive({ state, refreshRanking });

export const useRankingStore = () => rankingStore;
