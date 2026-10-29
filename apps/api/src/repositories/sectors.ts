import { and, eq } from 'drizzle-orm';
import type { getDb } from '../lib/db/index.js';
import { sectors } from '../lib/db/schema/sectors.js';

/** Narrowed db so world generation can pass a transaction or a stub. */
type InsertDb = Pick<ReturnType<typeof getDb>, 'insert'>;
type SelectDb = Pick<ReturnType<typeof getDb>, 'select'>;

/** Returns the new sector's id, or undefined if its coordinates are already taken. */
export async function insertSectorIfAbsent(db: InsertDb, values: typeof sectors.$inferInsert) {
  const [created] = await db
    .insert(sectors)
    .values(values)
    .onConflictDoNothing({ target: [sectors.sectorX, sectors.sectorY] })
    .returning({ id: sectors.id });
  return created;
}

export async function findSectorByCoordinates(db: SelectDb, sectorX: number, sectorY: number) {
  const [row] = await db
    .select({ id: sectors.id, role: sectors.role })
    .from(sectors)
    .where(and(eq(sectors.sectorX, sectorX), eq(sectors.sectorY, sectorY)))
    .limit(1);
  return row;
}

export function listSectorCoordinates(db: SelectDb) {
  return db.select({ sectorX: sectors.sectorX, sectorY: sectors.sectorY }).from(sectors);
}
