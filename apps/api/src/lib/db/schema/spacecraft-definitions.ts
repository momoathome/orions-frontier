import { pgTable, uuid, text, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const spacecraftDefinitions = pgTable('spacecraft_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').unique().notNull(),
  name: text('name').notNull(),
  description: text('description'),
  role: text('role').notNull(),
  image: text('image'),
  attack: integer('attack').notNull().default(0),
  defense: integer('defense').notNull().default(0),
  cargo: integer('cargo').notNull().default(0),
  speed: integer('speed').notNull().default(0),
  miningRate: integer('mining_rate').notNull().default(0),
  buildTime: integer('build_time').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const spacecraftDefinitionCosts = pgTable(
  'spacecraft_definition_costs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spacecraftDefinitionId: uuid('spacecraft_definition_id')
      .notNull()
      .references(() => spacecraftDefinitions.id),
    resourceKey: text('resource_key').notNull(),
    amount: integer('amount').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    definitionResourceUnique: uniqueIndex(
      'spacecraft_definition_costs_definition_resource_unique'
    ).on(table.spacecraftDefinitionId, table.resourceKey),
  })
);
