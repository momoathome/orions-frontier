import { buildingKeys, defenseUpgradeKeys, isOneOf } from '@orions-frontier/shared';
import { getDb } from '../../lib/db/index.js';
import { listBuildingLevelsByStations } from '../../repositories/station-buildings.js';
import { listSpacecraftAmountsByStations } from '../../repositories/station-spacecrafts.js';
import { buildings, defenseUpgrades, getSpacecraft } from '@orions-frontier/game-config';
import type {
  BuildingKey,
  DefenseUpgradeKey,
  StationVisualProfile,
  StationVisualTier,
} from '@orions-frontier/shared';

type StationBuildingLevels = Partial<Record<BuildingKey, number>>;
type StationDefenseLevels = Partial<Record<DefenseUpgradeKey, number>>;

interface StationTrafficCounts {
  civilian: number;
  military: number;
}

const emptyModules = (): StationVisualProfile['modules'] => ({
  core: 0,
  shipyard: 0,
  warehouse: 0,
  scanner: 0,
  hangar: 0,
  laboratory: 0,
});

const emptyDefense = (): StationVisualProfile['defense'] => ({
  armor_plating: 0,
  guardian_cannon: 0,
  defense_drones: 0,
  minefield: 0,
});

export const levelVisualTier = (level: number): StationVisualTier => {
  if (level <= 0) return 0;
  if (level < 5) return 1;
  if (level < 10) return 2;
  return 3;
};

export const trafficVisualTier = (amount: number): StationVisualTier => {
  if (amount <= 0) return 0;
  if (amount < 5) return 1;
  if (amount < 15) return 2;
  return 3;
};

export function buildStationVisualProfile(
  levels: StationBuildingLevels,
  defenseLevels: StationDefenseLevels,
  traffic: StationTrafficCounts
): StationVisualProfile {
  const modules = emptyModules();
  const defense = emptyDefense();
  let totalLevel = 0;

  for (const building of buildings) {
    const level = levels[building.key] ?? 0;
    modules[building.key] = levelVisualTier(level);
    totalLevel += level;
  }

  for (const upgrade of defenseUpgrades) {
    const level = defenseLevels[upgrade.key] ?? upgrade.startingLevel;
    defense[upgrade.key] = levelVisualTier(level);
  }

  const scaleTier: StationVisualTier =
    totalLevel <= buildings.length ? 0 : totalLevel <= 18 ? 1 : totalLevel <= 36 ? 2 : 3;

  return {
    scaleTier,
    modules,
    defense,
    traffic: {
      civilian: trafficVisualTier(traffic.civilian),
      military: trafficVisualTier(traffic.military),
    },
  };
}

export const starterStationVisualProfile = (): StationVisualProfile =>
  buildStationVisualProfile(
    Object.fromEntries(buildings.map((building) => [building.key, 1])),
    Object.fromEntries(defenseUpgrades.map((upgrade) => [upgrade.key, upgrade.startingLevel])),
    { civilian: 1, military: 0 }
  );

export async function getStationVisualProfiles(
  stationIds: readonly string[]
): Promise<Map<string, StationVisualProfile>> {
  if (stationIds.length === 0) return new Map();

  const db = getDb();
  const [buildingRows, spacecraftRows] = await Promise.all([
    listBuildingLevelsByStations(db, [...stationIds]),
    listSpacecraftAmountsByStations(db, [...stationIds]),
  ]);

  const levelsByStation = new Map<string, StationBuildingLevels>();
  const defenseLevelsByStation = new Map<string, StationDefenseLevels>();
  for (const row of buildingRows) {
    if (isOneOf(buildingKeys, row.buildingKey)) {
      const levels = levelsByStation.get(row.stationId) ?? {};
      levels[row.buildingKey] = row.level;
      levelsByStation.set(row.stationId, levels);
    } else if (isOneOf(defenseUpgradeKeys, row.buildingKey)) {
      const levels = defenseLevelsByStation.get(row.stationId) ?? {};
      levels[row.buildingKey] = row.level;
      defenseLevelsByStation.set(row.stationId, levels);
    }
  }

  const trafficByStation = new Map<string, StationTrafficCounts>();
  for (const row of spacecraftRows) {
    const traffic = trafficByStation.get(row.stationId) ?? { civilian: 0, military: 0 };
    const role = getSpacecraft(row.spacecraftKey)?.role;
    if (role === 'fighter') traffic.military += row.amount;
    else if (role) traffic.civilian += row.amount;
    trafficByStation.set(row.stationId, traffic);
  }

  return new Map(
    stationIds.map((stationId) => [
      stationId,
      buildStationVisualProfile(
        levelsByStation.get(stationId) ?? {},
        defenseLevelsByStation.get(stationId) ?? {},
        trafficByStation.get(stationId) ?? { civilian: 0, military: 0 }
      ),
    ])
  );
}
