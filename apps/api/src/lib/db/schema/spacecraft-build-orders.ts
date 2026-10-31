import { pgTable, uuid, integer, timestamp, index, varchar, jsonb } from 'drizzle-orm/pg-core';
import type { SpacecraftDefinitionCost } from '@orions-frontier/shared';
import { stations } from './stations.js';

export const spacecraftBuildOrders = pgTable(
  'spacecraft_build_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id),
    spacecraftKey: varchar('spacecraft_key', { length: 64 }).notNull(),
    /** Ships still to build; drops by one each step. */
    amount: integer('amount').notNull(),
    orderedAmount: integer('ordered_amount').notNull(),
    /** What one ship of this order cost; a cancel refunds this per unbuilt ship. */
    unitCost: jsonb('unit_cost').$type<SpacecraftDefinitionCost[]>().notNull(),
    /** Shipyard production slot the order runs in; each slot builds one order at a time. */
    slot: integer('slot').notNull().default(0),
    /** Time per ship; 0 for orders from before ships came one at a time. */
    stepMs: integer('step_ms').notNull().default(0),
    /** When the next ship is done; endsAt is when the last one is. */
    nextAt: timestamp('next_at').notNull(),
    endsAt: timestamp('ends_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('spacecraft_build_orders_station_id_idx').on(table.stationId),
    index('spacecraft_build_orders_spacecraft_key_idx').on(table.spacecraftKey),
    index('spacecraft_build_orders_next_at_idx').on(table.nextAt),
  ]
);
