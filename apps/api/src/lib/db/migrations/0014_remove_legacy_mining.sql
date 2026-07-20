DELETE FROM "spacecraft_build_orders"
WHERE "spacecraft_definition_id" IN (
  SELECT "id" FROM "spacecraft_definitions" WHERE "key" IN ('nomad', 'hercules')
);
--> statement-breakpoint
DELETE FROM "asteroid_assignments"
WHERE "spacecraft_definition_id" IN (
  SELECT "id" FROM "spacecraft_definitions" WHERE "key" IN ('nomad', 'hercules')
);
--> statement-breakpoint
DELETE FROM "station_spacecrafts"
WHERE "spacecraft_definition_id" IN (
  SELECT "id" FROM "spacecraft_definitions" WHERE "key" IN ('nomad', 'hercules')
);
--> statement-breakpoint
DELETE FROM "spacecraft_definition_costs"
WHERE "spacecraft_definition_id" IN (
  SELECT "id" FROM "spacecraft_definitions" WHERE "key" IN ('nomad', 'hercules')
);
--> statement-breakpoint
DELETE FROM "spacecraft_definitions" WHERE "key" IN ('nomad', 'hercules');
--> statement-breakpoint
DROP TABLE IF EXISTS "asteroid_resource_storage";
--> statement-breakpoint
ALTER TABLE "asteroids" DROP COLUMN IF EXISTS "stability";
--> statement-breakpoint
ALTER TABLE "asteroid_veins" DROP COLUMN IF EXISTS "yield_per_hour";
--> statement-breakpoint
ALTER TABLE "asteroid_veins" DROP COLUMN IF EXISTS "purity";
--> statement-breakpoint
ALTER TABLE "asteroid_veins" DROP COLUMN IF EXISTS "purity_tier";
--> statement-breakpoint
ALTER TABLE "asteroid_assignments" DROP COLUMN IF EXISTS "last_tick";
