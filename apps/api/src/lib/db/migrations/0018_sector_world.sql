ALTER TABLE "spawn_slots"
ADD COLUMN "slot_type" varchar(16) NOT NULL DEFAULT 'player';

DROP INDEX IF EXISTS "spawn_slots_slot_index_unique";

CREATE UNIQUE INDEX "spawn_slots_sector_slot_unique"
ON "spawn_slots" ("sector_id", "slot_index");

CREATE UNIQUE INDEX "spawn_slots_station_id_unique"
ON "spawn_slots" ("station_id");

ALTER TABLE "stations"
ADD COLUMN "sector_id" uuid REFERENCES "sectors"("id");

UPDATE "stations"
SET "sector_id" = "spawn_slots"."sector_id"
FROM "spawn_slots"
WHERE "spawn_slots"."station_id" = "stations"."id";

CREATE INDEX "stations_sector_id_idx" ON "stations" ("sector_id");
