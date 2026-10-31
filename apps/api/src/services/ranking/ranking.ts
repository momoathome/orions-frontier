import {
  calculateInfluence,
  isResearchKey,
  type InfluenceInput,
} from '@orions-frontier/game-config';
import type { Ranking, RankingEntry } from '@orions-frontier/shared';
import { getDb } from '../../lib/db/index.js';
import {
  listBuildingLevelsByStations,
  listSpacecraftAmountsByStations,
  listActiveStationOwners,
} from '../station/index.js';
import { listUserResearchByUsers } from '../research/index.js';

/** Server-wide ranking by the Influence of every station and ship a player owns. */
export async function getRanking(userId: string, limit: number): Promise<Ranking> {
  const db = getDb();
  // ponytail: loads every station's levels and fleet per request; cache or materialize once player counts grow.
  const owners = await listActiveStationOwners(db);
  const stationIds = owners.map((owner) => owner.stationId);
  const userIds = [...new Set(owners.map((owner) => owner.userId))];
  const [levelRows, researchRows, spacecraftRows] =
    stationIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          listBuildingLevelsByStations(db, stationIds),
          listUserResearchByUsers(db, userIds),
          listSpacecraftAmountsByStations(db, stationIds),
        ]);

  const ownerByStation = new Map(owners.map((owner) => [owner.stationId, owner.userId]));
  const inputs = new Map<string, InfluenceInput>();
  const entries = new Map<string, Omit<RankingEntry, 'rank' | 'influence'>>();
  for (const owner of owners) {
    const entry = entries.get(owner.userId) ?? {
      userId: owner.userId,
      username: owner.username,
      ownerType: owner.botUserId ? ('bot' as const) : ('player' as const),
      stationCount: 0,
    };
    entry.stationCount += 1;
    entries.set(owner.userId, entry);
    if (!inputs.has(owner.userId)) {
      inputs.set(owner.userId, { levels: [], research: {}, spacecrafts: [] });
    }
  }
  const inputFor = (stationId: string) => {
    const owner = ownerByStation.get(stationId);
    return owner ? inputs.get(owner) : undefined;
  };
  for (const row of levelRows) {
    inputFor(row.stationId)?.levels.push({ key: row.buildingKey, level: row.level });
  }
  for (const row of researchRows) {
    const input = inputs.get(row.userId);
    if (input && isResearchKey(row.technologyKey)) input.research[row.technologyKey] = row.level;
  }
  for (const row of spacecraftRows) {
    inputFor(row.stationId)?.spacecrafts.push({ key: row.spacecraftKey, amount: row.amount });
  }

  const sorted = [...entries.values()]
    .map((entry) => ({
      ...entry,
      influence: calculateInfluence(
        inputs.get(entry.userId) ?? { levels: [], research: {}, spacecrafts: [] }
      ),
    }))
    .sort((a, b) => b.influence.total - a.influence.total || a.username.localeCompare(b.username));
  // Equal Influence shares a rank (1, 2, 2, 4).
  let rank = 0;
  let previousTotal = Number.NaN;
  const ranked = sorted.map(({ influence, ...entry }, index) => {
    if (influence.total !== previousTotal) rank = index + 1;
    previousTotal = influence.total;
    return { rank, ...entry, influence: influence.total, breakdown: influence };
  });
  const own = ranked.find((entry) => entry.userId === userId);

  return {
    // Other players see only the total, never how it splits into buildings, defense and fleet.
    top: ranked.slice(0, limit).map(({ breakdown: _, ...entry }): RankingEntry => entry),
    me: own ?? null,
    totalPlayers: ranked.length,
  };
}
