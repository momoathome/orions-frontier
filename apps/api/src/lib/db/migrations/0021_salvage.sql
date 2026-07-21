ALTER TYPE "trip_purpose" ADD VALUE IF NOT EXISTS 'salvage';
ALTER TYPE "trip_purpose" ADD VALUE IF NOT EXISTS 'salvage_return';
ALTER TYPE "trip_endpoint_type" ADD VALUE IF NOT EXISTS 'debris';

CREATE TABLE "debris_fields" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sector_id" uuid NOT NULL REFERENCES "sectors"("id"),
  "x" integer NOT NULL,
  "y" integer NOT NULL,
  "chunk_x" integer NOT NULL,
  "chunk_y" integer NOT NULL,
  "resources" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX "debris_fields_chunk_idx" ON "debris_fields" ("chunk_x", "chunk_y");
CREATE INDEX "debris_fields_sector_id_idx" ON "debris_fields" ("sector_id");

CREATE TABLE "salvage_missions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "station_id" uuid NOT NULL REFERENCES "stations"("id"),
  "debris_field_id" uuid REFERENCES "debris_fields"("id"),
  "station_spacecraft_id" uuid NOT NULL REFERENCES "station_spacecrafts"("id"),
  "outbound_trip_id" uuid NOT NULL REFERENCES "spacecraft_trips"("id"),
  "return_trip_id" uuid REFERENCES "spacecraft_trips"("id"),
  "amount" integer NOT NULL,
  "cargo" jsonb,
  "status" varchar(16) NOT NULL DEFAULT 'traveling',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "resolved_at" timestamp
);
CREATE INDEX "salvage_missions_user_id_idx" ON "salvage_missions" ("user_id");
CREATE INDEX "salvage_missions_debris_field_id_idx" ON "salvage_missions" ("debris_field_id");
