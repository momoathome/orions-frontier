import { getSpacecraft } from '@orions-frontier/game-config';
import { getDb } from '../../lib/db/index.js';
import { listTravelingTripsBySpacecraft } from '../../repositories/spacecraft-trips.js';
import { listStationSpacecraftKeysByStations } from '../../repositories/station-spacecrafts.js';
import { listStationIdsByUser } from '../../repositories/stations.js';

/** All traveling trips across the user's stations, for the map's in-flight spacecraft. */
export async function getActiveUserTrips(userId: string) {
  const db = getDb();

  // Use stations.userId not id
  const stationRows = await listStationIdsByUser(db, userId);

  if (stationRows.length === 0) {
    return [];
  }

  const stationIds = stationRows.map((s) => s.id);

  // Get all stationSpacecraft ids for this user's stations
  const ssRows = await listStationSpacecraftKeysByStations(db, stationIds);

  if (ssRows.length === 0) {
    return [];
  }

  const ssIds = ssRows.map((s) => s.id);
  const ssInfoMap = new Map(ssRows.map((s) => [s.id, s]));

  // Get all active trips
  const trips = await listTravelingTripsBySpacecraft(db, ssIds);

  return trips.map((trip) => {
    const ss = ssInfoMap.get(trip.stationSpacecraftId);
    const spacecraft = ss ? getSpacecraft(ss.spacecraftKey) : undefined;
    return {
      id: trip.id,
      groupSize: trip.groupSize,
      fromType: trip.fromType,
      fromId: trip.fromId,
      toType: trip.toType,
      toId: trip.toId,
      departedAt: trip.departedAt.toISOString(),
      arrivesAt: trip.arrivesAt.toISOString(),
      purpose: trip.purpose,
      cargoManifest: trip.cargoManifest,
      spacecraft: spacecraft
        ? {
            role: spacecraft.role,
            speed: spacecraft.speed,
            cargo: spacecraft.cargo,
            name: spacecraft.name,
            image: spacecraft.image,
          }
        : null,
    };
  });
}
