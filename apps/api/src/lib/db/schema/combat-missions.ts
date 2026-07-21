import {
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { spacecraftTrips } from './spacecraft-trips.js';
import { stationSpacecrafts } from './station-spacecrafts.js';
import { stations } from './stations.js';
import { users } from './users.js';

export const combatMissions = pgTable(
  'combat_missions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    attackerStationId: uuid('attacker_station_id')
      .notNull()
      .references(() => stations.id),
    defenderStationId: uuid('defender_station_id')
      .notNull()
      .references(() => stations.id),
    attackerStationSpacecraftId: uuid('attacker_station_spacecraft_id')
      .notNull()
      .references(() => stationSpacecrafts.id),
    outboundTripId: uuid('outbound_trip_id')
      .notNull()
      .references(() => spacecraftTrips.id),
    returnTripId: uuid('return_trip_id').references(() => spacecraftTrips.id),
    attackerAmount: integer('attacker_amount').notNull(),
    attackerLosses: integer('attacker_losses').notNull().default(0),
    defenderLosses: integer('defender_losses').notNull().default(0),
    winner: varchar('winner', { length: 16 }),
    loot: jsonb('loot').$type<Record<string, number>>(),
    status: varchar('status', { length: 16 }).notNull().default('traveling'),
    resolvedAt: timestamp('resolved_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    outboundUnique: uniqueIndex('combat_missions_outbound_trip_unique').on(table.outboundTripId),
    returnUnique: uniqueIndex('combat_missions_return_trip_unique').on(table.returnTripId),
    userIdx: index('combat_missions_user_id_idx').on(table.userId),
    statusIdx: index('combat_missions_status_idx').on(table.status),
  })
);
