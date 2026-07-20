-- Adds the finite reserve used by the new arrival-based mining cycle.
-- Legacy yield, purity and stability columns remain until the new cycle replaces the old tick.

ALTER TABLE "asteroid_veins"
  ADD COLUMN IF NOT EXISTS "remaining_amount" integer NOT NULL DEFAULT 10000;

ALTER TABLE "asteroid_veins"
  DROP CONSTRAINT IF EXISTS "asteroid_veins_remaining_amount_non_negative";

ALTER TABLE "asteroid_veins"
  ADD CONSTRAINT "asteroid_veins_remaining_amount_non_negative"
  CHECK ("remaining_amount" >= 0);
