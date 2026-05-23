-- ============================================================================
-- 0011_sectors
-- World Generation v4: Sector-Based Infinite Expansion System
--
-- Adds:
--   sectors        — one row per independently-generated sector
--   asteroids.sector_id  — FK linking each asteroid to its sector
--   spawn_slots.sector_id — FK linking each spawn slot to its sector
--
-- Both FK columns are nullable to preserve existing data across migrations.
-- ============================================================================

-- sectors table
CREATE TABLE IF NOT EXISTS sectors (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_x     INTEGER     NOT NULL,
  sector_y     INTEGER     NOT NULL,
  archetype_id VARCHAR(64) NOT NULL,
  seed         VARCHAR(256) NOT NULL,
  gameplay_tags JSONB       NOT NULL DEFAULT '[]',
  created_at   TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sectors_coords_unique
  ON sectors (sector_x, sector_y);

CREATE INDEX IF NOT EXISTS sectors_archetype_id_idx
  ON sectors (archetype_id);

-- Link asteroids to their sector
ALTER TABLE asteroids
  ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES sectors(id);

CREATE INDEX IF NOT EXISTS asteroids_sector_id_idx
  ON asteroids (sector_id)
  WHERE sector_id IS NOT NULL;

-- Link spawn_slots to their sector
ALTER TABLE spawn_slots
  ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES sectors(id);

CREATE INDEX IF NOT EXISTS spawn_slots_sector_id_idx
  ON spawn_slots (sector_id)
  WHERE sector_id IS NOT NULL;
