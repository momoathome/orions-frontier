ALTER TABLE spacecraft_trips ADD COLUMN settle_failures INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE spacecraft_trips ADD COLUMN retry_at TIMESTAMP;
