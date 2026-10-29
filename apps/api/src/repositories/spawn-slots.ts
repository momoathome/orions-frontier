import type { getDb } from '../lib/db/index.js';
import { spawnSlots } from '../lib/db/schema/spawn-slots.js';

/** Narrowed db so world generation can pass a transaction or a stub. */
type InsertDb = Pick<ReturnType<typeof getDb>, 'insert'>;

export async function insertSpawnSlots(db: InsertDb, rows: (typeof spawnSlots.$inferInsert)[]) {
  await db.insert(spawnSlots).values(rows);
}
