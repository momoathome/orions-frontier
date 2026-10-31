ALTER TABLE spacecraft_build_orders ADD COLUMN ordered_amount INTEGER;
--> statement-breakpoint
UPDATE spacecraft_build_orders SET ordered_amount = amount;
--> statement-breakpoint
ALTER TABLE spacecraft_build_orders ALTER COLUMN ordered_amount SET NOT NULL;
--> statement-breakpoint
ALTER TABLE spacecraft_build_orders ADD COLUMN step_ms INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE spacecraft_build_orders ADD COLUMN slot INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE spacecraft_build_orders ADD COLUMN next_at TIMESTAMP;
--> statement-breakpoint
UPDATE spacecraft_build_orders SET next_at = ends_at;
--> statement-breakpoint
ALTER TABLE spacecraft_build_orders ALTER COLUMN next_at SET NOT NULL;
--> statement-breakpoint
CREATE INDEX spacecraft_build_orders_next_at_idx ON spacecraft_build_orders (next_at);
