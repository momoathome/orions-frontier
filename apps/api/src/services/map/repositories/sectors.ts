import { and, asc, eq, notExists, sql } from 'drizzle-orm';
import type { getDb, QueryDb, Tx } from '../../../lib/db/index.js';
import { sectors } from '../../../lib/db/schema/sectors.js';
import { spawnSlots } from '../../../lib/db/schema/spawn-slots.js';
import { stations } from '../../../lib/db/schema/stations.js';
import { worldMissions } from '../../../lib/db/schema/world-missions.js';

/** Narrowed db so world generation can pass a transaction or a stub. */
type InsertDb = Pick<ReturnType<typeof getDb>, 'insert'>;
type SelectDb = Pick<ReturnType<typeof getDb>, 'select'>;
type ExecuteDb = Pick<ReturnType<typeof getDb>, 'execute'>;

export interface SectorSize {
  WIDTH: number;
  HEIGHT: number;
}

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
    .select()
    .from(sectors)
    .where(and(eq(sectors.sectorX, sectorX), eq(sectors.sectorY, sectorY)))
    .limit(1);
  return row;
}

export function listSectorCoordinates(db: SelectDb) {
  return db.select({ sectorX: sectors.sectorX, sectorY: sectors.sectorY }).from(sectors);
}

/** A frontier sector without an active station or a colonization on its way there. */
const isUnsettledFrontier = () =>
  and(
    eq(sectors.role, 'frontier'),
    notExists(
      sql`(select 1 from ${stations} where ${stations.sectorId} = ${sectors.id} and ${stations.destroyedAt} is null)`
    ),
    notExists(
      sql`(select 1 from ${worldMissions} where ${worldMissions.missionType} = 'colonization' and ${worldMissions.status} = 'traveling' and ${worldMissions.targetSectorX} = ${sectors.sectorX} and ${worldMissions.targetSectorY} = ${sectors.sectorY})`
    )
  );

export function listUnsettledFrontierSectors(db: QueryDb) {
  return db
    .select({
      id: sectors.id,
      sectorX: sectors.sectorX,
      sectorY: sectors.sectorY,
      seed: sectors.seed,
    })
    .from(sectors)
    .where(isUnsettledFrontier());
}

/** Turns an unsettled frontier sector into a settlement; false if it no longer qualifies. */
export async function claimFrontierSectorForSettlement(tx: Tx, id: string): Promise<boolean> {
  const claimed = await tx
    .update(sectors)
    .set({ role: 'settlement' })
    .where(and(eq(sectors.id, id), isUnsettledFrontier()))
    .returning({ id: sectors.id });
  return claimed.length > 0;
}

/** Serializes colonizing and settling one sector for the rest of the transaction. */
export async function lockSectorColonization(tx: Tx, sectorId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'colony:' + sectorId}))`);
}

/** Undiscovered coordinates next to known sectors, nearest to `origin` first. */
export async function listFrontierCoordinates(
  db: ExecuteDb,
  origin: { x: number; y: number },
  sectorSize: SectorSize,
  limit: number
): Promise<{ sectorX: number; sectorY: number }[]> {
  return db.execute(sql<{ sectorX: number; sectorY: number }>`
    with candidates as (
      select distinct
        s.sector_x + direction.dx as "sectorX",
        s.sector_y + direction.dy as "sectorY"
      from ${sectors} s
      cross join (values (1, 0), (-1, 0), (0, 1), (0, -1)) as direction(dx, dy)
      where not exists (
        select 1
        from ${sectors} existing
        where existing.sector_x = s.sector_x + direction.dx
          and existing.sector_y = s.sector_y + direction.dy
      )
    )
    select "sectorX", "sectorY"
    from candidates
    order by
      power("sectorX"::double precision * ${sectorSize.WIDTH} - ${origin.x}, 2) +
      power("sectorY"::double precision * ${sectorSize.HEIGHT} - ${origin.y}, 2),
      "sectorY",
      "sectorX"
    limit ${limit}
  `);
}

/** True if no sector exists at the coordinates but one borders it. */
export async function isUnknownFrontierCoordinate(
  db: ExecuteDb,
  sectorX: number,
  sectorY: number
): Promise<boolean> {
  const rows = await db.execute(sql<{ found: number }>`
    select 1 as found
    where not exists (
      select 1 from ${sectors}
      where ${sectors.sectorX} = ${sectorX} and ${sectors.sectorY} = ${sectorY}
    ) and exists (
      select 1 from ${sectors}
      where abs(${sectors.sectorX} - ${sectorX}) + abs(${sectors.sectorY} - ${sectorY}) = 1
    )
  `);
  return rows.length > 0;
}

/** Known sectors nearest to `origin` first. */
export function listNearestSectors(
  db: QueryDb,
  origin: { x: number; y: number },
  sectorSize: SectorSize,
  limit: number
) {
  return db
    .select()
    .from(sectors)
    .orderBy(
      sql`power(${sectors.sectorX}::double precision * ${sectorSize.WIDTH} - ${origin.x}, 2) + power(${sectors.sectorY}::double precision * ${sectorSize.HEIGHT} - ${origin.y}, 2)`,
      asc(sectors.sectorY),
      asc(sectors.sectorX)
    )
    .limit(limit);
}

/** Settlement sectors with generated bot slots; hand-made fixtures have none. */
export function listBotSettlementSectorIds(db: QueryDb) {
  return db
    .selectDistinct({ id: sectors.id })
    .from(sectors)
    .innerJoin(spawnSlots, eq(spawnSlots.sectorId, sectors.id))
    .where(and(eq(sectors.role, 'settlement'), eq(spawnSlots.slotType, 'bot')));
}

export async function findSettlementSector(db: QueryDb, id: string) {
  const [row] = await db
    .select({ id: sectors.id, sectorX: sectors.sectorX, sectorY: sectors.sectorY })
    .from(sectors)
    .where(and(eq(sectors.id, id), eq(sectors.role, 'settlement')))
    .limit(1);
  return row;
}
