ALTER TYPE "trip_purpose" ADD VALUE IF NOT EXISTS 'mining_return' AFTER 'mine';

ALTER TABLE "spacecraft_trips"
  ADD COLUMN IF NOT EXISTS "assignment_id" uuid
  REFERENCES "asteroid_assignments"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "spacecraft_trips_assignment_id_idx"
  ON "spacecraft_trips" ("assignment_id");
