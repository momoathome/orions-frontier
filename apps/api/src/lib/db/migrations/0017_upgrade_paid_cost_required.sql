-- Upgrades started before 0015 stored no cost; they refund nothing when cancelled.
UPDATE station_buildings SET upgrade_paid_cost = '[]'::jsonb
WHERE upgrade_ends_at IS NOT NULL AND upgrade_paid_cost IS NULL;
--> statement-breakpoint
ALTER TABLE station_buildings ADD CONSTRAINT station_buildings_running_upgrade_has_cost
CHECK (upgrade_ends_at IS NULL OR upgrade_paid_cost IS NOT NULL);
