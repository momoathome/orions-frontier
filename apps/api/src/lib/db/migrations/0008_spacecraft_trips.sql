-- ============================================================================
-- 0008_spacecraft_trips
-- Adds time-based travel system for all spacecraft types.
-- ============================================================================

--> statement-breakpoint
CREATE TYPE "trip_purpose" AS ENUM ('mine', 'transport', 'recall', 'return', 'combat');
--> statement-breakpoint
CREATE TYPE "trip_status" AS ENUM ('traveling', 'arrived', 'cancelled');
--> statement-breakpoint
CREATE TYPE "trip_endpoint_type" AS ENUM ('station', 'asteroid');
--> statement-breakpoint
CREATE TYPE "assignment_status" AS ENUM ('traveling_to_asteroid', 'at_asteroid', 'traveling_to_station');
--> statement-breakpoint

-- Add status column to existing asteroid_assignments
ALTER TABLE "asteroid_assignments"
  ADD COLUMN "status" "assignment_status" NOT NULL DEFAULT 'at_asteroid';
--> statement-breakpoint

-- Create spacecraft_trips table
CREATE TABLE "spacecraft_trips" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "station_spacecraft_id"  uuid NOT NULL REFERENCES "station_spacecrafts"("id") ON DELETE CASCADE,
  "group_size"             integer NOT NULL,
  "from_type"              "trip_endpoint_type" NOT NULL,
  "from_id"               uuid NOT NULL,
  "to_type"               "trip_endpoint_type" NOT NULL,
  "to_id"                 uuid NOT NULL,
  "departed_at"           timestamp NOT NULL,
  "arrives_at"            timestamp NOT NULL,
  "purpose"               "trip_purpose" NOT NULL,
  "cargo_manifest"        jsonb,
  "status"                "trip_status" NOT NULL DEFAULT 'traveling',
  "created_at"            timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX "spacecraft_trips_station_spacecraft_id_idx" ON "spacecraft_trips" ("station_spacecraft_id");
--> statement-breakpoint
CREATE INDEX "spacecraft_trips_status_idx" ON "spacecraft_trips" ("status");
--> statement-breakpoint
CREATE INDEX "spacecraft_trips_arrives_at_idx" ON "spacecraft_trips" ("arrives_at");
--> statement-breakpoint
CREATE INDEX "spacecraft_trips_to_id_idx" ON "spacecraft_trips" ("to_id");
