import { randomUUID } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { botControllers } from '../../lib/db/schema/bot-controllers.js';
import { sectors } from '../../lib/db/schema/sectors.js';
import { stations } from '../../lib/db/schema/stations.js';
import { users } from '../../lib/db/schema/users.js';
import { WORLD_CONFIG } from '../../lib/world-config.js';
import { createStation } from '../station.service.js';
import { profileForKey } from './bot-profiles.js';

const coordinateKey = (value: number) => (value < 0 ? `m${-value}` : `p${value}`);

export async function seedBotsForOccupiedSectors(): Promise<void> {
  const db = getDb();
  const settlementSectors = await db
    .select({ id: sectors.id })
    .from(sectors)
    .where(eq(sectors.role, 'settlement'));

  for (const sector of settlementSectors) {
    await seedBotsForSector(sector.id);
  }
}

export async function seedBotsForSector(sectorId: string): Promise<void> {
  const db = getDb();
  const [sector] = await db
    .select({ id: sectors.id, sectorX: sectors.sectorX, sectorY: sectors.sectorY })
    .from(sectors)
    .where(and(eq(sectors.id, sectorId), eq(sectors.role, 'settlement')))
    .limit(1);
  if (!sector) return;

  const [human] = await db
    .select({ id: stations.id })
    .from(stations)
    .innerJoin(users, eq(stations.userId, users.id))
    .where(and(eq(stations.sectorId, sector.id), ne(users.role, 'bot')))
    .limit(1);
  if (!human) return;

  const existingBots = await db
    .select({ userId: users.id })
    .from(stations)
    .innerJoin(users, eq(stations.userId, users.id))
    .where(and(eq(stations.sectorId, sector.id), eq(users.role, 'bot')));
  for (const bot of existingBots) {
    await db
      .insert(botControllers)
      .values({ userId: bot.userId, profile: profileForKey(bot.userId) })
      .onConflictDoNothing({ target: botControllers.userId });
  }

  for (let index = 1; index <= WORLD_CONFIG.SECTOR.BOTS_PER_SETTLEMENT; index += 1) {
    const key = `${coordinateKey(sector.sectorX)}-${coordinateKey(sector.sectorY)}-${index}`;
    const username = `orion-bot-${key}`;
    const email = `${username}@system.invalid`;
    const [createdUser] = await db
      .insert(users)
      .values({
        username,
        email,
        passwordHash: `disabled:${randomUUID()}`,
        role: 'bot',
      })
      .onConflictDoNothing()
      .returning({ id: users.id });
    const [user] = createdUser
      ? [createdUser]
      : await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (!user) continue;

    await db
      .insert(botControllers)
      .values({ userId: user.id, profile: profileForKey(key) })
      .onConflictDoNothing({ target: botControllers.userId });

    await createStation(user.id, {
      name: `Prospector ${index}`,
      slotType: 'bot',
      sectorId: sector.id,
    });
  }
}
