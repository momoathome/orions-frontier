CREATE TABLE "station_influence" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "station_id" uuid NOT NULL REFERENCES "stations"("id") ON DELETE CASCADE,
  "points" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "station_influence_user_id_station_id_pk" PRIMARY KEY("user_id", "station_id")
);
CREATE INDEX "station_influence_station_id_idx" ON "station_influence" ("station_id");
