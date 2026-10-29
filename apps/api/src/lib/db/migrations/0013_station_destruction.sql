ALTER TYPE trip_purpose ADD VALUE 'relocate';
--> statement-breakpoint
ALTER TABLE stations ADD COLUMN integrity INTEGER NOT NULL DEFAULT 100;
--> statement-breakpoint
ALTER TABLE stations ADD COLUMN integrity_updated_at TIMESTAMP NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE stations ADD COLUMN destroyed_at TIMESTAMP;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN protected_until TIMESTAMP;
--> statement-breakpoint
ALTER TABLE combat_missions ADD COLUMN attacker_fleet JSONB;
--> statement-breakpoint
UPDATE combat_missions SET attacker_fleet = jsonb_build_object(station_spacecrafts.spacecraft_key, combat_missions.attacker_amount)
FROM station_spacecrafts WHERE station_spacecrafts.id = combat_missions.attacker_station_spacecraft_id;
--> statement-breakpoint
ALTER TABLE combat_missions ALTER COLUMN attacker_fleet SET NOT NULL;
--> statement-breakpoint
ALTER TABLE combat_missions ADD COLUMN attacker_survivors JSONB;
--> statement-breakpoint
UPDATE combat_missions SET attacker_survivors = jsonb_build_object(station_spacecrafts.spacecraft_key, combat_missions.attacker_amount - combat_missions.attacker_losses)
FROM station_spacecrafts WHERE station_spacecrafts.id = combat_missions.attacker_station_spacecraft_id AND combat_missions.status <> 'traveling';
--> statement-breakpoint
ALTER TABLE combat_missions DROP COLUMN attacker_station_spacecraft_id;
--> statement-breakpoint
ALTER TABLE combat_missions ADD COLUMN integrity_damage INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE combat_missions ADD COLUMN defender_integrity INTEGER;
--> statement-breakpoint
ALTER TABLE combat_missions ADD COLUMN station_destroyed BOOLEAN NOT NULL DEFAULT false;
