-- In-progress spacecraft build orders (one row per batch, deleted on completion)
CREATE TABLE "spacecraft_build_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"spacecraft_definition_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"ends_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "spacecraft_build_orders_station_id_fkey"
		FOREIGN KEY ("station_id") REFERENCES "stations"("id"),
	CONSTRAINT "spacecraft_build_orders_spacecraft_definition_id_fkey"
		FOREIGN KEY ("spacecraft_definition_id") REFERENCES "spacecraft_definitions"("id")
);
--> statement-breakpoint

CREATE INDEX "spacecraft_build_orders_station_id_idx"
	ON "spacecraft_build_orders" ("station_id");
--> statement-breakpoint

CREATE INDEX "spacecraft_build_orders_definition_id_idx"
	ON "spacecraft_build_orders" ("spacecraft_definition_id");
