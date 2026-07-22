import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../../middleware/auth.js';
import { getDb } from '../../../lib/db/index.js';
import { stations } from '../../../lib/db/schema/stations.js';
import { startDefenseUpgrade } from '../../../services/defense.service.js';
import {
  AppError,
  defenseUpgradeKeys,
  ErrorCode,
  type DefenseUpgradeKey,
} from '@orions-frontier/shared';

export default (async (app) => {
  app.post('/defense/:upgradeKey/upgrade', { preHandler: [authenticate] }, async (request) => {
    const { stationId, upgradeKey } = request.params as {
      stationId: string;
      upgradeKey: string;
    };

    if (!(defenseUpgradeKeys as readonly string[]).includes(upgradeKey)) {
      throw new AppError(ErrorCode.INVALID_INPUT, `Unknown defense upgrade key: ${upgradeKey}`);
    }

    const [station] = await getDb()
      .select({ id: stations.id })
      .from(stations)
      .where(and(eq(stations.id, stationId), eq(stations.userId, request.user.userId)))
      .limit(1);

    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

    return startDefenseUpgrade(station.id, upgradeKey as DefenseUpgradeKey, request.user.userId);
  });
}) satisfies FastifyPluginAsync;
