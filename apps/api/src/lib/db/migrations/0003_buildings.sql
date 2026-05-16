-- Building definition templates (static / seeded)
CREATE TABLE "building_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text UNIQUE NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"image" text,
	"base_build_time" integer DEFAULT 60 NOT NULL,
	"max_level" integer DEFAULT 10 NOT NULL,
	"effect_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Per-station building state
CREATE TABLE "station_buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"building_definition_id" uuid NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"upgrade_ends_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "station_buildings_station_id_fkey"
		FOREIGN KEY ("station_id") REFERENCES "stations"("id"),
	CONSTRAINT "station_buildings_building_definition_id_fkey"
		FOREIGN KEY ("building_definition_id") REFERENCES "building_definitions"("id"),
	CONSTRAINT "station_buildings_station_id_building_definition_id_unique"
		UNIQUE ("station_id", "building_definition_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "station_buildings_station_id_idx" ON "station_buildings" ("station_id");
