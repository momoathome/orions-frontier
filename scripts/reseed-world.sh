#!/bin/bash
# Lösche alle Asteroid-Daten und generiere die Welt neu.
# Die asteroid_veins, asteroid_resource_storage und asteroid_assignments
# werden automatisch per FK CASCADE gelöscht wenn asteroids geleert wird.

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

# ── Asteroid-Daten löschen ────────────────────────────────────────────────

echo "🗑️   Lösche Asteroid-Daten..."
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
DELETE FROM asteroid_assignments;
DELETE FROM asteroid_resource_storage;
DELETE FROM asteroid_veins;
DELETE FROM asteroids;
SELECT
  (SELECT COUNT(*) FROM asteroids)               AS asteroids,
  (SELECT COUNT(*) FROM asteroid_veins)          AS veins,
  (SELECT COUNT(*) FROM asteroid_resource_storage) AS storage,
  (SELECT COUNT(*) FROM asteroid_assignments)    AS assignments;
SQL

echo ""

# ── API neu starten → Seed läuft beim Start automatisch ──────────────────

echo "🔄  Starte API neu (Seed läuft beim Start automatisch)..."
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
  (SELECT COUNT(*) FROM asteroids)               AS asteroids,
  (SELECT COUNT(*) FROM asteroid_veins)          AS veins,
  (SELECT COUNT(*) FROM asteroid_resource_storage) AS storage,
  (SELECT COUNT(*) FROM asteroid_assignments)    AS assignments;

SELECT size, COUNT(*) AS count, ROUND(AVG(stability)::numeric, 3) AS avg_stability
FROM asteroids
GROUP BY size
ORDER BY CASE size WHEN 'small' THEN 1 WHEN 'medium' THEN 2 WHEN 'large' THEN 3 WHEN 'massive' THEN 4 END;
SQL

echo ""
echo "✅  Welt neu generiert!"
