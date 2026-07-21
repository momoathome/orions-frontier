CREATE TABLE "combat_missions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "attacker_station_id" uuid NOT NULL REFERENCES "stations"("id"),
  "defender_station_id" uuid NOT NULL REFERENCES "stations"("id"),
  "attacker_station_spacecraft_id" uuid NOT NULL REFERENCES "station_spacecrafts"("id"),
  "outbound_trip_id" uuid NOT NULL REFERENCES "spacecraft_trips"("id"),
  "return_trip_id" uuid REFERENCES "spacecraft_trips"("id"),
  "attacker_amount" integer NOT NULL,
  "attacker_losses" integer NOT NULL DEFAULT 0,
  "defender_losses" integer NOT NULL DEFAULT 0,
  "winner" varchar(16),
  "loot" jsonb,
  "status" varchar(16) NOT NULL DEFAULT 'traveling',
  "resolved_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "combat_missions_outbound_trip_unique" ON "combat_missions" ("outbound_trip_id");
CREATE UNIQUE INDEX "combat_missions_return_trip_unique" ON "combat_missions" ("return_trip_id");
CREATE INDEX "combat_missions_user_id_idx" ON "combat_missions" ("user_id");
CREATE INDEX "combat_missions_status_idx" ON "combat_missions" ("status");
