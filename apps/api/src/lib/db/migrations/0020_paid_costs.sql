-- Orders and research started before this stored no cost; they refund nothing when cancelled.
ALTER TABLE spacecraft_build_orders ADD COLUMN unit_cost JSONB NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE spacecraft_build_orders ALTER COLUMN unit_cost DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE user_research ADD COLUMN paid_cost JSONB;
--> statement-breakpoint
UPDATE user_research SET paid_cost = '[]'::jsonb WHERE completes_at IS NOT NULL;
--> statement-breakpoint
ALTER TABLE user_research ADD CONSTRAINT user_research_running_has_cost
CHECK (completes_at IS NULL OR paid_cost IS NOT NULL);
