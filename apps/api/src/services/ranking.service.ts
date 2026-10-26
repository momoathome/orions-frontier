import { eq } from 'drizzle-orm';
import { calculateBuildingEffect } from '@orions-frontier/game-config';
import type { Ranking, RankingEntry } from '@orions-frontier/shared';
import { getDb } from '../lib/db/index.js';
import { botControllers } from '../lib/db/schema/bot-controllers.js';
import { stationBuildings } from '../lib/db/schema/station-buildings.js';
import { stations } from '../lib/db/schema/stations.js';
import { users } from '../lib/db/schema/users.js';

const stationScore = (coreLevel: number): number =>
  calculateBuildingEffect('core', coreLevel).find((effect) => effect.type === 'station_progression')
    ?.value ?? 0;

/** Server-wide ranking by the summed Station Score of every station a player owns. */
export async function getRanking(userId: string, limit: number): Promise<Ranking> {
  // ponytail: scores every station per request; cache or materialize once player counts grow.
  const rows = await getDb()
    .select({
      userId: users.id,
      username: users.username,
      botUserId: botControllers.userId,
      coreLevel: stationBuildings.level,
    })
    .from(stations)
    .innerJoin(users, eq(users.id, stations.userId))
    .innerJoin(stationBuildings, eq(stationBuildings.stationId, stations.id))
    .leftJoin(botControllers, eq(botControllers.userId, users.id))
    .where(eq(stationBuildings.buildingKey, 'core'));

  const byUser = new Map<string, Omit<RankingEntry, 'rank'>>();
  for (const row of rows) {
    const entry = byUser.get(row.userId) ?? {
      userId: row.userId,
      username: row.username,
      ownerType: row.botUserId ? ('bot' as const) : ('player' as const),
      stationCount: 0,
      score: 0,
    };
    entry.stationCount += 1;
    entry.score += stationScore(row.coreLevel);
    byUser.set(row.userId, entry);
  }

  const sorted = [...byUser.values()].sort(
    (a, b) => b.score - a.score || a.username.localeCompare(b.username)
  );
  // Equal scores share a rank (1, 2, 2, 4).
  let rank = 0;
  let previousScore = Number.NaN;
  const ranked = sorted.map((entry, index): RankingEntry => {
    if (entry.score !== previousScore) rank = index + 1;
    previousScore = entry.score;
    return { rank, ...entry };
  });

  return {
    top: ranked.slice(0, limit),
    me: ranked.find((entry) => entry.userId === userId) ?? null,
    totalPlayers: ranked.length,
  };
}
