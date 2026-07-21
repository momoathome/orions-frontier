-- No world state is productive yet. Reset it once instead of carrying nullable
-- sector assignments and removed simulation states into the new generator.
TRUNCATE TABLE "sectors" CASCADE;

ALTER TABLE "asteroid_assignments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "assignment_status" RENAME TO "assignment_status_old";
CREATE TYPE "assignment_status" AS ENUM ('traveling_to_asteroid', 'traveling_to_station');
ALTER TABLE "asteroid_assignments"
  ALTER COLUMN "status" TYPE "assignment_status"
  USING "status"::text::"assignment_status";
ALTER TABLE "asteroid_assignments"
  ALTER COLUMN "status" SET DEFAULT 'traveling_to_asteroid';
DROP TYPE "assignment_status_old";

ALTER TYPE "trip_purpose" RENAME TO "trip_purpose_old";
CREATE TYPE "trip_purpose" AS ENUM (
  'mine',
  'mining_return',
  'combat',
  'combat_return',
  'salvage',
  'salvage_return'
);
ALTER TABLE "spacecraft_trips"
  ALTER COLUMN "purpose" TYPE "trip_purpose"
  USING "purpose"::text::"trip_purpose";
DROP TYPE "trip_purpose_old";

ALTER TABLE "stations" ALTER COLUMN "sector_id" SET NOT NULL;
ALTER TABLE "asteroids" ALTER COLUMN "sector_id" SET NOT NULL;
ALTER TABLE "spawn_slots" ALTER COLUMN "sector_id" SET NOT NULL;
