-- ============================================================================
-- 0009_performance_indexes
-- Adds missing indexes for the hot paths identified in the performance audit:
--
-- asteroid_assignments:
--   • (status)              — mining-tick-worker full-table scan every 60 s
--   • (station_id, status)  — transport-dispatch WHERE station_id + status
--   • (asteroid_id, status) — miner-recall WHERE asteroid_id + status
--
-- spacecraft_trips:
--   • (from_id)              — return-trip counting uses from_id IN (...) with no index
--   • (status, arrives_at)   — watchdog poll: WHERE status='traveling' AND arrives_at <= now
--   • (to_type, purpose, status, to_id) — outbound-trip counting composite
--
-- station_spacecrafts:
--   • (station_id, spacecraft_definition_id) — transport-dispatch joins on both
-- ============================================================================

-- ── asteroid_assignments ─────────────────────────────────────────────────────

-- Simple status index: mining-tick-worker top-level scan
CREATE INDEX IF NOT EXISTS "asteroid_assignments_status_idx"
  ON "asteroid_assignments" ("status");

-- Composite (station_id, status): transport-dispatch candidate query
-- Supersedes the old station_id-only index for that query pattern.
CREATE INDEX IF NOT EXISTS "asteroid_assignments_station_status_idx"
  ON "asteroid_assignments" ("station_id", "status");

-- Composite (asteroid_id, status): miner-recall at_asteroid check
-- Supersedes the old asteroid_id-only index for that query pattern.
CREATE INDEX IF NOT EXISTS "asteroid_assignments_asteroid_status_idx"
  ON "asteroid_assignments" ("asteroid_id", "status");

-- ── spacecraft_trips ─────────────────────────────────────────────────────────

-- from_id: return-trip rows are queried by from_id (asteroid → station leg)
CREATE INDEX IF NOT EXISTS "spacecraft_trips_from_id_idx"
  ON "spacecraft_trips" ("from_id");

-- (status, arrives_at): watchdog processTripArrivals poll
CREATE INDEX IF NOT EXISTS "spacecraft_trips_status_arrives_at_idx"
  ON "spacecraft_trips" ("status", "arrives_at");

-- (to_type, purpose, status, to_id): outbound transport trip counting
CREATE INDEX IF NOT EXISTS "spacecraft_trips_outbound_idx"
  ON "spacecraft_trips" ("to_type", "purpose", "status", "to_id");

-- (from_type, purpose, status, from_id): return transport trip counting
CREATE INDEX IF NOT EXISTS "spacecraft_trips_return_idx"
  ON "spacecraft_trips" ("from_type", "purpose", "status", "from_id");

-- ── station_spacecrafts ──────────────────────────────────────────────────────

-- (station_id, spacecraft_definition_id): dispatch inner-join hit
CREATE INDEX IF NOT EXISTS "station_spacecrafts_station_def_idx"
  ON "station_spacecrafts" ("station_id", "spacecraft_definition_id");
