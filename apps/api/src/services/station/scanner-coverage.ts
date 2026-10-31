import { calculateScannerRange } from '@orions-frontier/game-config';
import { getDb, type QueryDb } from '../../lib/db/index.js';
import type { ScannerCoverage } from '../map/index.js';
import { getUserResearchModifiers } from '../research/index.js';
import { listScannerStationsByUser } from './repositories/stations.js';

/** Scanner circles of the user's stations; map holds the visibility math, station the data. */
export async function getUserScannerCoverages(
  userId: string,
  db: QueryDb = getDb()
): Promise<ScannerCoverage[]> {
  const rows = await listScannerStationsByUser(db, userId);
  const modifiers = await getUserResearchModifiers(userId, db);

  return rows.map((row) => ({
    stationId: row.stationId,
    x: row.x,
    y: row.y,
    range: calculateScannerRange(row.level) * modifiers.scannerRange,
  }));
}
