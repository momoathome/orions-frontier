-- ============================================================================
-- 0006_asteroid_persistent_system
-- Breaking change: asteroid table redesigned for persistent mining system.
-- Removes: resource_type, richness, is_depleted
-- Changes: stability integer → double precision, adds size
-- Adds: asteroid_veins, asteroid_resource_storage, asteroid_assignments
-- NOTE: Existing asteroid rows are cleared (no veins = invalid state).
-- ============================================================================

-- Clear existing world data (cascades are not defined yet, so order matters)
DELETE FROM "asteroids";
--> statement-breakpoint

-- Drop old columns from asteroids
ALTER TABLE "asteroids" DROP COLUMN IF EXISTS "resource_type";
--> statement-breakpoint
ALTER TABLE "asteroids" DROP COLUMN IF EXISTS "richness";
--> statement-breakpoint
ALTER TABLE "asteroids" DROP COLUMN IF EXISTS "is_depleted";
--> statement-breakpoint

-- Change stability from integer to double precision
ALTER TABLE "asteroids" ALTER COLUMN "stability" TYPE double precision USING stability::double precision / 100.0;
--> statement-breakpoint

-- Add size column
ALTER TABLE "asteroids" ADD COLUMN "size" varchar(16) NOT NULL DEFAULT 'small';
--> statement-breakpoint

-- Remove the temporary default (asteroids are always seeded fresh)
ALTER TABLE "asteroids" ALTER COLUMN "size" DROP DEFAULT;
--> statement-breakpoint

-- ── asteroid_veins ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "asteroid_veins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asteroid_id" uuid NOT NULL,
  "vein_type" varchar(16) NOT NULL,
  "resource_key" varchar(64) NOT NULL,
  "yield_per_hour" double precision NOT NULL,
  "purity" double precision NOT NULL,
  "purity_tier" varchar(16) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "asteroid_veins_asteroid_id_fkey"
    FOREIGN KEY ("asteroid_id") REFERENCES "asteroids"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asteroid_veins_asteroid_id_idx" ON "asteroid_veins" ("asteroid_id");
--> statement-breakpoint

-- ── asteroid_resource_storage ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "asteroid_resource_storage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asteroid_id" uuid NOT NULL,
  "resource_key" varchar(64) NOT NULL,
  "amount" double precision NOT NULL DEFAULT 0,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "asteroid_resource_storage_asteroid_id_fkey"
    FOREIGN KEY ("asteroid_id") REFERENCES "asteroids"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asteroid_resource_storage_asteroid_id_idx"
  ON "asteroid_resource_storage" ("asteroid_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asteroid_resource_storage_unique"
  ON "asteroid_resource_storage" ("asteroid_id", "resource_key");
--> statement-breakpoint

-- ── asteroid_assignments ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "asteroid_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asteroid_id" uuid NOT NULL,
  "station_id" uuid NOT NULL,
  "spacecraft_definition_id" uuid NOT NULL,
  "assigned_amount" integer NOT NULL DEFAULT 1,
  "assigned_at" timestamp DEFAULT now() NOT NULL,
  "last_tick" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "asteroid_assignments_asteroid_id_fkey"
    FOREIGN KEY ("asteroid_id") REFERENCES "asteroids"("id") ON DELETE CASCADE,
  CONSTRAINT "asteroid_assignments_station_id_fkey"
    FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE CASCADE,
  CONSTRAINT "asteroid_assignments_spacecraft_definition_id_fkey"
    FOREIGN KEY ("spacecraft_definition_id") REFERENCES "spacecraft_definitions"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asteroid_assignments_asteroid_id_idx"
  ON "asteroid_assignments" ("asteroid_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asteroid_assignments_station_id_idx"
  ON "asteroid_assignments" ("station_id");
