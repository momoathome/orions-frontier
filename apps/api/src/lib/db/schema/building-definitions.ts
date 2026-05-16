import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const buildingDefinitions = pgTable('building_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').unique().notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  image: text('image'),
  baseBuildTime: integer('base_build_time').notNull().default(60),
  maxLevel: integer('max_level').notNull().default(10),
  effectType: text('effect_type').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type BuildingDefinitionRow = typeof buildingDefinitions.$inferSelect;
export type NewBuildingDefinition = typeof buildingDefinitions.$inferInsert;
