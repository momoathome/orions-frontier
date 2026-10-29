import { WORLD_CONFIG } from '../lib/world-config.js';
import { calcDistance } from '../lib/travel.js';
import { generateSector } from '../lib/world-gen/sector-gen.js';

const reserveByResource = (sector: ReturnType<typeof generateSector>) => {
  const result: Record<string, number> = {};
  for (const asteroid of sector.asteroids) {
    for (const vein of asteroid.veins) {
      result[vein.resourceKey] = (result[vein.resourceKey] ?? 0) + vein.remainingAmount;
    }
  }
  return result;
};

const radius = WORLD_CONFIG.INITIAL_SECTOR_RADIUS;
const rows = [];
for (let sectorY = -radius; sectorY <= radius; sectorY += 1) {
  for (let sectorX = -radius; sectorX <= radius; sectorX += 1) {
    const role = sectorX === 0 && sectorY === 0 ? 'settlement' : 'frontier';
    const sector = generateSector(sectorX, sectorY, WORLD_CONFIG.WORLD_SEED, role);
    const reserve = reserveByResource(sector);
    const origins = sector.spawnSlots.length
      ? sector.spawnSlots
      : [
          {
            x: sectorX * WORLD_CONFIG.SECTOR.WIDTH,
            y: sectorY * WORLD_CONFIG.SECTOR.HEIGHT,
          },
        ];
    const nearest = (resourceKey: string) =>
      Math.round(
        Math.min(
          ...sector.asteroids
            .filter((asteroid) => asteroid.veins.some((vein) => vein.resourceKey === resourceKey))
            .flatMap((asteroid) => origins.map((origin) => calcDistance(origin, asteroid)))
        )
      );
    rows.push({
      sector: `${sectorX},${sectorY}`,
      role,
      asteroids: sector.asteroids.length,
      total: Object.values(reserve).reduce((sum, amount) => sum + amount, 0),
      carbon: reserve['carbon'] ?? 0,
      titanium: reserve['titanium'] ?? 0,
      hydrogenium: reserve['hydrogenium'] ?? 0,
      kyber: reserve['kyber_crystal'] ?? 0,
      astatine: reserve['astatine'] ?? 0,
      nearestC: nearest('carbon'),
      nearestT: nearest('titanium'),
      nearestH: nearest('hydrogenium'),
    });
  }
}

console.table(rows);
