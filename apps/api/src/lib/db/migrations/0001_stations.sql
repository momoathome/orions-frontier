CREATE TABLE IF NOT EXISTS "stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stations_user_id_idx" ON "stations" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "station_spacecrafts" (
	"station_id" uuid NOT NULL,
	"spacecraft_key" varchar(64) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"locked_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "station_spacecrafts_pkey" PRIMARY KEY ("station_id","spacecraft_key"),
	CONSTRAINT "station_spacecrafts_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "station_spacecrafts_station_id_idx" ON "station_spacecrafts" ("station_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "station_resources" (
	"station_id" uuid NOT NULL,
	"resource_key" varchar(64) NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "station_resources_pkey" PRIMARY KEY ("station_id","resource_key"),
	CONSTRAINT "station_resources_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "station_resources_station_id_idx" ON "station_resources" ("station_id");
