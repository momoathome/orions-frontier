-- Migration 0007: spawn_slots table
-- Pre-generated station spawn positions placed deterministically in the spawnRing.
-- One slot per player, evenly distributed on a circle at ~88% of the world radius.
-- Asteroids are kept clear of each slot (SAFE_RADIUS = 500 world units).

CREATE TABLE IF NOT EXISTS "spawn_slots" (
  "id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slot_index"  integer     NOT NULL,
  "x"           integer     NOT NULL,
  "y"           integer     NOT NULL,
  "station_id"  uuid        REFERENCES "stations"("id"),
  "created_at"  timestamp   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "spawn_slots_slot_index_unique"
  ON "spawn_slots" ("slot_index");

CREATE INDEX IF NOT EXISTS "spawn_slots_station_id_idx"
  ON "spawn_slots" ("station_id");
