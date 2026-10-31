ALTER TABLE station_buildings ADD COLUMN upgrade_paid_cost JSONB;
--> statement-breakpoint
CREATE TABLE queued_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq SERIAL NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  kind VARCHAR(16) NOT NULL,
  key VARCHAR(64) NOT NULL,
  target_level INTEGER NOT NULL,
  paid_cost JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX queued_jobs_station_id_idx ON queued_jobs (station_id);
--> statement-breakpoint
CREATE INDEX queued_jobs_user_id_idx ON queued_jobs (user_id);
