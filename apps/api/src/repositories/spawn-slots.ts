import { and, asc, eq, isNull } from 'drizzle-orm';
import type { getDb, Tx } from '../lib/db/index.js';
import { sectors } from '../lib/db/schema/sectors.js';
import { spawnSlots } from '../lib/db/schema/spawn-slots.js';

/** Narrowed db so world generation can pass a transaction or a stub. */
type InsertDb = Pick<ReturnType<typeof getDb>, 'insert'>;

export async function insertSpawnSlots(db: InsertDb, rows: (typeof spawnSlots.$inferInsert)[]) {
  await db.insert(spawnSlots).values(rows);
}

/** Locks the oldest free slot of that type in a settlement sector, with the sector seed. */
export async function findFreeSpawnSlotForUpdate(tx: Tx, slotType: string, sectorId?: string) {
  const conditions = [
    isNull(spawnSlots.stationId),
    eq(spawnSlots.slotType, slotType),
    eq(sectors.role, 'settlement'),
  ];
  if (sectorId) conditions.push(eq(sectors.id, sectorId));
  const [row] = await tx
    .select({ slot: spawnSlots, sectorSeed: sectors.seed })
    .from(spawnSlots)
    .innerJoin(sectors, eq(spawnSlots.sectorId, sectors.id))
    .where(and(...conditions))
    .orderBy(
      asc(sectors.createdAt),
      asc(sectors.sectorY),
      asc(sectors.sectorX),
      asc(spawnSlots.slotIndex)
    )
    .limit(1)
    .for('update');
  return row;
}

export async function assignSpawnSlot(tx: Tx, slotId: string, stationId: string) {
  await tx.update(spawnSlots).set({ stationId }).where(eq(spawnSlots.id, slotId));
}

/** Frees the station's slots for new stations. */
export async function releaseSpawnSlots(tx: Tx, stationId: string) {
  await tx.update(spawnSlots).set({ stationId: null }).where(eq(spawnSlots.stationId, stationId));
}
