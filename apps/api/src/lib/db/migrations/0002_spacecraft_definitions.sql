-- Drop old station_spacecrafts table (string-key based, replaced by FK approach)
DROP TABLE IF EXISTS "station_spacecrafts";
--> statement-breakpoint

-- Spacecraft definition templates
CREATE TABLE "spacecraft_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text UNIQUE NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"role" text NOT NULL,
	"image" text,
	"attack" integer DEFAULT 0 NOT NULL,
	"defense" integer DEFAULT 0 NOT NULL,
	"cargo" integer DEFAULT 0 NOT NULL,
	"speed" integer DEFAULT 0 NOT NULL,
	"mining_rate" integer DEFAULT 0 NOT NULL,
	"build_time" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Resource costs per spacecraft definition
CREATE TABLE "spacecraft_definition_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spacecraft_definition_id" uuid NOT NULL,
	"resource_key" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "spacecraft_definition_costs_spacecraft_definition_id_fkey"
		FOREIGN KEY ("spacecraft_definition_id") REFERENCES "spacecraft_definitions"("id")
);
--> statement-breakpoint

-- Station-owned spacecraft stacks
CREATE TABLE "station_spacecrafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"spacecraft_definition_id" uuid NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"locked_amount" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "station_spacecrafts_station_id_fkey"
		FOREIGN KEY ("station_id") REFERENCES "stations"("id"),
	CONSTRAINT "station_spacecrafts_spacecraft_definition_id_fkey"
		FOREIGN KEY ("spacecraft_definition_id") REFERENCES "spacecraft_definitions"("id"),
	CONSTRAINT "station_spacecrafts_station_id_spacecraft_definition_id_unique"
		UNIQUE ("station_id", "spacecraft_definition_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "station_spacecrafts_station_id_idx" ON "station_spacecrafts" ("station_id");
