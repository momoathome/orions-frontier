import { and, eq, inArray } from 'drizzle-orm';
import { calculateInfluence, type InfluenceInput } from '@orions-frontier/game-config';
import type { Ranking, RankingEntry } from '@orions-frontier/shared';
import { getDb } from '../lib/db/index.js';
import { botControllers } from '../lib/db/schema/bot-controllers.js';
import { stationBuildings } from '../lib/db/schema/station-buildings.js';
import { stationResearch } from '../lib/db/schema/station-research.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import { stations } from '../lib/db/schema/stations.js';
import { users } from '../lib/db/schema/users.js';

/** Server-wide ranking by the Influence of every station and ship a player owns. */
export async function getRanking(userId: string, limit: number): Promise<Ranking> {
  const db = getDb();
  // ponytail: loads every station's levels and fleet per request; cache or materialize once player counts grow.
  const owners = await db
    .select({
      stationId: stations.id,
      userId: users.id,
      username: users.username,
      botUserId: botControllers.userId,
    })
    .from(stations)
    .innerJoin(users, eq(users.id, stations.userId))
    .leftJoin(botControllers, eq(botControllers.userId, users.id));
  const stationIds = owners.map((owner) => owner.stationId);
  const [levelRows, researchRows, spacecraftRows] =
    stationIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          db
            .select({
              stationId: stationBuildings.stationId,
              key: stationBuildings.buildingKey,
              level: stationBuildings.level,
            })
            .from(stationBuildings)
            .where(inArray(stationBuildings.stationId, stationIds)),
          db
            .select({ stationId: stationResearch.stationId, key: stationResearch.technologyKey })
            .from(stationResearch)
            .where(
              and(
                inArray(stationResearch.stationId, stationIds),
                eq(stationResearch.status, 'completed')
              )
            ),
          db
            .select({
              stationId: stationSpacecrafts.stationId,
              key: stationSpacecrafts.spacecraftKey,
              amount: stationSpacecrafts.amount,
            })
            .from(stationSpacecrafts)
            .where(inArray(stationSpacecrafts.stationId, stationIds)),
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
      inputs.set(owner.userId, { levels: [], completedResearch: [], spacecrafts: [] });
    }
  }
  const inputFor = (stationId: string) => {
    const owner = ownerByStation.get(stationId);
    return owner ? inputs.get(owner) : undefined;
  };
  for (const row of levelRows) inputFor(row.stationId)?.levels.push(row);
  for (const row of researchRows) inputFor(row.stationId)?.completedResearch.push(row.key);
  for (const row of spacecraftRows) inputFor(row.stationId)?.spacecrafts.push(row);

  const sorted = [...entries.values()]
    .map((entry) => ({
      ...entry,
      influence: calculateInfluence(
        inputs.get(entry.userId) ?? { levels: [], completedResearch: [], spacecrafts: [] }
      ),
    }))
    .sort((a, b) => b.influence.total - a.influence.total || a.username.localeCompare(b.username));
  // Equal Influence shares a rank (1, 2, 2, 4).
  let rank = 0;
  let previousTotal = Number.NaN;
  const ranked = sorted.map((entry, index): RankingEntry => {
    if (entry.influence.total !== previousTotal) rank = index + 1;
    previousTotal = entry.influence.total;
    return { rank, ...entry };
  });

  return {
    top: ranked.slice(0, limit),
    me: ranked.find((entry) => entry.userId === userId) ?? null,
    totalPlayers: ranked.length,
  };
}
