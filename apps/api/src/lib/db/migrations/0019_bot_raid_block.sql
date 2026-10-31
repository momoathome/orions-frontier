ALTER TABLE bot_controllers ADD COLUMN raid_blocked_target VARCHAR(128);
--> statement-breakpoint
ALTER TABLE bot_controllers ADD COLUMN raid_blocked_until TIMESTAMP;
