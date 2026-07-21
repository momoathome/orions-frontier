CREATE TABLE "world_missions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "origin_station_id" uuid NOT NULL REFERENCES "stations"("id") ON DELETE CASCADE,
  "station_spacecraft_id" uuid NOT NULL REFERENCES "station_spacecrafts"("id"),
  "spacecraft_definition_id" uuid NOT NULL REFERENCES "spacecraft_definitions"("id"),
  "mission_type" varchar(16) NOT NULL,
  "target_sector_x" integer NOT NULL,
  "target_sector_y" integer NOT NULL,
  "target_x" double precision,
  "target_y" double precision,
  "colony_name" varchar(128),
  "departed_at" timestamp NOT NULL,
  "arrives_at" timestamp NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'traveling',
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "world_missions_due_idx" ON "world_missions" ("status", "arrives_at");
CREATE INDEX "world_missions_user_id_idx" ON "world_missions" ("user_id");
