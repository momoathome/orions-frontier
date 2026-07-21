CREATE TABLE "station_research" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "station_id" uuid NOT NULL REFERENCES "stations"("id") ON DELETE CASCADE,
  "technology_key" varchar(64) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'researching',
  "completes_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp,
  CONSTRAINT "station_research_station_technology_unique" UNIQUE("station_id", "technology_key")
);
CREATE INDEX "station_research_status_completes_at_idx"
  ON "station_research" ("status", "completes_at");
