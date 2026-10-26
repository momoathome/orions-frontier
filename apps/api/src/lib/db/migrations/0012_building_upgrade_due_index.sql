CREATE INDEX IF NOT EXISTS "station_buildings_upgrade_ends_at_idx" ON "station_buildings" ("upgrade_ends_at") WHERE "upgrade_ends_at" IS NOT NULL;
