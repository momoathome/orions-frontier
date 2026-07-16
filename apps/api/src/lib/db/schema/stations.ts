import { pgTable, uuid, varchar, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';

export const stations = pgTable(
  'stations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: varchar('name', { length: 128 }).notNull(),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('stations_user_id_idx').on(table.userId),
  })
);

export const stationsRelations = relations(stations, ({ one }) => ({
  user: one(users, {
    fields: [stations.userId],
    references: [users.id],
  }),
}));

export type Station = typeof stations.$inferSelect;
export type NewStation = typeof stations.$inferInsert;
