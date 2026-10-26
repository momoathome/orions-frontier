import type { UserRole, UserStatus } from '@orions-frontier/shared';
import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';

// Placeholder user table for authentication
// Will be extended in later phases
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 50 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role: varchar('role', { length: 20 }).$type<UserRole>().notNull().default('player'),
  status: varchar('status', { length: 20 }).$type<UserStatus>().notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  attackProtectionBrokenAt: timestamp('attack_protection_broken_at'),
});
