ALTER TABLE world_missions ADD COLUMN settle_failures INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE world_missions ADD COLUMN retry_at TIMESTAMP;
