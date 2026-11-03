import type { CombatReport, CombatScouting, ResourceMap } from '@orions-frontier/shared';
import {
  boolean,
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
    outboundTripId: uuid('outbound_trip_id')
      .notNull()
      .references(() => spacecraftTrips.id),
    returnTripId: uuid('return_trip_id').references(() => spacecraftTrips.id),
    /** Sent fleet as { spacecraftKey: amount }; attackerAmount is its total. */
    attackerFleet: jsonb('attacker_fleet').$type<Record<string, number>>().notNull(),
    /** Surviving ships per key, set when the battle resolves. */
    attackerSurvivors: jsonb('attacker_survivors').$type<Record<string, number>>(),
    attackerAmount: integer('attacker_amount').notNull(),
    attackerLosses: integer('attacker_losses').notNull().default(0),
    defenderLosses: integer('defender_losses').notNull().default(0),
    /** Destroyed defending ships per key; null before the battle and for older missions. */
    defenderShipLosses: jsonb('defender_ship_losses').$type<Record<string, number>>(),
    winner: varchar('winner', { length: 16 }).$type<'attacker' | 'defender'>(),
    loot: jsonb('loot').$type<ResourceMap>(),
    integrityDamage: integer('integrity_damage').notNull().default(0),
    /** Defender integrity after this wave; null when no battle took place. */
    defenderIntegrity: integer('defender_integrity'),
    stationDestroyed: boolean('station_destroyed').notNull().default(false),
    /** What the wave met at the target; the attacker only learns it with survivors. */
    scouting: jsonb('scouting').$type<CombatScouting>(),
    status: varchar('status', { length: 16 })
      .$type<CombatReport['status']>()
      .notNull()
      .default('traveling'),
    resolvedAt: timestamp('resolved_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('combat_missions_outbound_trip_unique').on(table.outboundTripId),
    uniqueIndex('combat_missions_return_trip_unique').on(table.returnTripId),
    index('combat_missions_user_id_idx').on(table.userId),
    index('combat_missions_status_idx').on(table.status),
  ]
);
