-- Per-player logbook of completed game events.
CREATE TABLE logbook_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id VARCHAR(255) NOT NULL,
  type VARCHAR(32) NOT NULL,
  station_id UUID,
  summary VARCHAR(255) NOT NULL,
  occurred_at TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX logbook_entries_user_event_idx ON logbook_entries (user_id, event_id);
--> statement-breakpoint
CREATE INDEX logbook_entries_user_occurred_idx ON logbook_entries (user_id, occurred_at);
