#!/bin/bash
# Löscht alle Welt-Daten (Asteroiden + Spawn-Slots) und generiert die Welt neu.
# Stations, User und Definitionen werden NICHT angetastet.

set -e

echo "🌍  World Reseed"
echo ""

# ── Prüfen ob postgres läuft ───────────────────────────────────────────────

if ! docker ps --format '{{.Names}}' | grep -q "orions-frontier-postgres"; then
  echo "❌  PostgreSQL-Container läuft nicht. Erst starten:"
  echo "    docker compose up -d"
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q "orions-frontier-api"; then
  echo "❌  API-Container läuft nicht. Erst starten:"
  echo "    docker compose up -d"
  exit 1
fi

# ── Env laden ─────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/../.env"
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-orions}"
POSTGRES_DB="${POSTGRES_DB:-orions_frontier}"

# ── Welt-Daten löschen ───────────────────────────────────────────────────

echo "🗑️   Lösche Asteroiden + Spawn-Slots (Stations, User, Definitionen bleiben)..."
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
DELETE FROM asteroid_assignments;
DELETE FROM asteroid_resource_storage;
DELETE FROM asteroid_veins;
DELETE FROM asteroids;
-- Spawn-Slot → Station-Referenz lösen, dann Slots löschen (Stations bleiben).
UPDATE spawn_slots SET station_id = NULL;
DELETE FROM spawn_slots;
SELECT
  (SELECT COUNT(*) FROM asteroids)                 AS asteroids,
  (SELECT COUNT(*) FROM asteroid_veins)            AS veins,
  (SELECT COUNT(*) FROM asteroid_resource_storage) AS storage,
  (SELECT COUNT(*) FROM spawn_slots)               AS spawn_slots;
SQL

echo ""

# ── API neu starten → World-Gen läuft beim Start automatisch ─────────────

echo "🔄  Starte API neu (World-Gen läuft beim Start automatisch)..."
echo "🔧  Baue @orions-frontier/game-config im Container..."
docker compose exec api pnpm --filter @orions-frontier/game-config build
docker compose restart api

echo ""
echo "⏳  Warte bis API bereit ist..."

MAX_WAIT=60
WAITED=0
until curl -sf http://localhost:3000/api/health > /dev/null 2>&1; do
  if [ "$WAITED" -ge "$MAX_WAIT" ]; then
    echo "❌  API antwortet nach ${MAX_WAIT}s nicht."
    exit 1
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done

echo "✅  API ist bereit."
echo ""

# ── Ergebnis prüfen ───────────────────────────────────────────────────────

echo "📊  Generierungsergebnis:"
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
SELECT
  (SELECT COUNT(*) FROM asteroids)                 AS asteroids,
  (SELECT COUNT(*) FROM asteroid_veins)            AS veins,
  (SELECT COUNT(*) FROM asteroid_resource_storage) AS storage;

SELECT
  a.size,
  COUNT(DISTINCT a.id)                       AS count,
  ROUND(AVG(a.stability)::numeric, 3)        AS avg_stability,
  ROUND(AVG(v.total_yield)::numeric, 1)      AS avg_yield_per_hour
FROM asteroids a
LEFT JOIN (
  SELECT asteroid_id, SUM(yield_per_hour) AS total_yield
  FROM asteroid_veins
  GROUP BY asteroid_id
) v ON v.asteroid_id = a.id
GROUP BY a.size
ORDER BY CASE a.size WHEN 'small' THEN 1 WHEN 'medium' THEN 2 WHEN 'large' THEN 3 WHEN 'massive' THEN 4 END;

WITH world AS (
  SELECT MAX(SQRT(x * x + y * y)) AS radius FROM asteroids
),
zones AS (
  SELECT
    CASE
      WHEN SQRT(a.x * a.x + a.y * a.y) / w.radius <= 0.1 THEN 'core'
      WHEN SQRT(a.x * a.x + a.y * a.y) / w.radius <= 0.4 THEN 'midRing'
      WHEN SQRT(a.x * a.x + a.y * a.y) / w.radius <= 0.7 THEN 'frontier'
      ELSE 'spawnRing'
    END AS zone
  FROM asteroids a, world w
)
SELECT zone, COUNT(*) AS count
FROM zones
GROUP BY zone
ORDER BY CASE zone WHEN 'core' THEN 1 WHEN 'midRing' THEN 2 WHEN 'frontier' THEN 3 WHEN 'spawnRing' THEN 4 END;
SQL

echo ""
echo "✅  Welt neu generiert!"
