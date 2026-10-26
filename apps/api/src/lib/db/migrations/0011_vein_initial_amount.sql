ALTER TABLE "asteroid_veins" ADD COLUMN "initial_amount" integer DEFAULT 10000 NOT NULL;
--> statement-breakpoint
-- Already mined veins start their depletion display from today's reserve.
UPDATE "asteroid_veins" SET "initial_amount" = "remaining_amount";
