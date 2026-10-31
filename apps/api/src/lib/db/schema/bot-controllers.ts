import { index, integer, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const botProfiles = ['industrialist', 'pioneer', 'technocrat', 'warlord'] as const;
export type BotProfile = (typeof botProfiles)[number];

export const goalTypes = [
  'stabilize_station',
  'increase_income',
  'increase_capacity',
  'research_technology',
  'explore_sector',
  'establish_colony',
  'fortify_station',
  'build_strike_force',
  'raid',
  'retaliate',
  'salvage',
] as const;
export type GoalType = (typeof goalTypes)[number];

export const botControllers = pgTable(
  'bot_controllers',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    strategy: varchar('strategy', { length: 32 }).notNull().default('goal_v1'),
    strategyVersion: varchar('strategy_version', { length: 32 }).notNull().default('1'),
    profile: varchar('profile', { length: 16 })
      .$type<BotProfile>()
      .notNull()
      .default('industrialist'),
    activeGoalType: varchar('active_goal_type', { length: 32 }).$type<GoalType>(),
    activeGoalTarget: varchar('active_goal_target', { length: 128 }),
    goalStartedAt: timestamp('goal_started_at'),
    lastProgressAt: timestamp('last_progress_at'),
    blockedCount: integer('blocked_count').notNull().default(0),
    /** Owners whose stations turned out to be protected: owner id to ISO time until skipped. */
    raidBlockedOwners: jsonb('raid_blocked_owners')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    /** Learned goal-category weights; null means the profile's start weights. */
    categoryWeights: jsonb('category_weights').$type<Record<string, number>>(),
    nextDecisionAt: timestamp('next_decision_at').notNull().defaultNow(),
    lastAction: varchar('last_action', { length: 64 }),
    lastReason: varchar('last_reason', { length: 255 }),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [index('bot_controllers_next_decision_at_idx').on(table.nextDecisionAt)]
);
