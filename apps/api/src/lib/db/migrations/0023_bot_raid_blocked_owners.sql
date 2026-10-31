ALTER TABLE bot_controllers ADD COLUMN raid_blocked_owners JSONB NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE bot_controllers DROP COLUMN raid_blocked_target;
--> statement-breakpoint
ALTER TABLE bot_controllers DROP COLUMN raid_blocked_until;
