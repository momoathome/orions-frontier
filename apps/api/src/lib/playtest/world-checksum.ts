import { createHash } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { asteroids, asteroidVeins } from '../db/schema/asteroids.js';
import { sectors } from '../db/schema/sectors.js';
import { spawnSlots } from '../db/schema/spawn-slots.js';

export interface PlaytestWorldSummary {
  checksum: string;
  sectors: number;
  asteroids: number;
  veins: number;
  spawnSlots: number;
  resourceUnits: number;
}

export async function calculatePlaytestWorldChecksum(): Promise<PlaytestWorldSummary> {
  const db = getDb();
  const [sectorRows, asteroidRows, veinRows, slotRows, resourceTotal] = await Promise.all([
    db
      .select({
        id: sectors.id,
        sectorX: sectors.sectorX,
        sectorY: sectors.sectorY,
        role: sectors.role,
        seed: sectors.seed,
        createdAt: sectors.createdAt,
      })
      .from(sectors)
      .orderBy(asc(sectors.sectorY), asc(sectors.sectorX)),
    db
      .select({
        id: asteroids.id,
        sectorX: sectors.sectorX,
        sectorY: sectors.sectorY,
        x: asteroids.x,
        y: asteroids.y,
        chunkX: asteroids.chunkX,
        chunkY: asteroids.chunkY,
        size: asteroids.size,
        createdAt: asteroids.createdAt,
      })
      .from(asteroids)
      .innerJoin(sectors, eq(asteroids.sectorId, sectors.id))
      .orderBy(
        asc(sectors.sectorY),
        asc(sectors.sectorX),
        asc(asteroids.y),
        asc(asteroids.x),
        asc(asteroids.id)
      ),
    db
      .select({
        id: asteroidVeins.id,
        asteroidId: asteroidVeins.asteroidId,
        sectorX: sectors.sectorX,
        sectorY: sectors.sectorY,
        asteroidX: asteroids.x,
        asteroidY: asteroids.y,
        veinType: asteroidVeins.veinType,
        resourceKey: asteroidVeins.resourceKey,
        remainingAmount: asteroidVeins.remainingAmount,
        createdAt: asteroidVeins.createdAt,
      })
      .from(asteroidVeins)
      .innerJoin(asteroids, eq(asteroidVeins.asteroidId, asteroids.id))
      .innerJoin(sectors, eq(asteroids.sectorId, sectors.id))
      .orderBy(
        asc(sectors.sectorY),
        asc(sectors.sectorX),
        asc(asteroids.y),
        asc(asteroids.x),
        asc(asteroidVeins.veinType),
        asc(asteroidVeins.resourceKey),
        asc(asteroidVeins.id)
      ),
    db
      .select({
        id: spawnSlots.id,
        sectorX: sectors.sectorX,
        sectorY: sectors.sectorY,
        slotIndex: spawnSlots.slotIndex,
        slotType: spawnSlots.slotType,
        x: spawnSlots.x,
        y: spawnSlots.y,
        createdAt: spawnSlots.createdAt,
      })
      .from(spawnSlots)
      .innerJoin(sectors, eq(spawnSlots.sectorId, sectors.id))
      .orderBy(asc(sectors.sectorY), asc(sectors.sectorX), asc(spawnSlots.slotIndex)),
    db
      .select({
        amount: sql<number>`coalesce(sum(${asteroidVeins.remainingAmount}), 0)::bigint`,
      })
      .from(asteroidVeins),
  ]);

  const canonical = JSON.stringify({
    sectors: sectorRows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    asteroids: asteroidRows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    veins: veinRows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    spawnSlots: slotRows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
  });
  return {
    checksum: createHash('sha256').update(canonical).digest('hex'),
    sectors: sectorRows.length,
    asteroids: asteroidRows.length,
    veins: veinRows.length,
    spawnSlots: slotRows.length,
    resourceUnits: Number(resourceTotal[0]?.amount ?? 0),
  };
}
