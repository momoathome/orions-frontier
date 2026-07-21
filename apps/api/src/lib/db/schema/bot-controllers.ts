import { index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const botControllers = pgTable(
  'bot_controllers',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    strategy: varchar('strategy', { length: 32 }).notNull().default('economic_v1'),
    nextDecisionAt: timestamp('next_decision_at').notNull().defaultNow(),
    lastAction: varchar('last_action', { length: 64 }),
    lastReason: varchar('last_reason', { length: 255 }),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    nextDecisionAtIdx: index('bot_controllers_next_decision_at_idx').on(table.nextDecisionAt),
  })
);
