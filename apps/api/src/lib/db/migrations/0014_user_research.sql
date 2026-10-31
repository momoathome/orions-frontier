DROP TABLE station_research;
--> statement-breakpoint
CREATE TABLE user_research (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  technology_key VARCHAR(64) NOT NULL,
  level INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMP,
  completes_at TIMESTAMP,
  paid_by_station_id UUID REFERENCES stations(id) ON DELETE SET NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT user_research_user_technology_unique UNIQUE (user_id, technology_key)
);
--> statement-breakpoint
CREATE INDEX user_research_completes_at_idx ON user_research (completes_at);
