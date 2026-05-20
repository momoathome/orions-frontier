#!/bin/bash
# Cycle Reset: Wischt alle Spieldaten und startet einen neuen Cycle.
# User-Accounts bleiben erhalten, alles andere wird neu geseeded.

set -e

echo "🔄  Cycle Reset — Orion's Frontier"
echo ""
echo "Alle Spieldaten werden gelöscht (Asteroiden, Stationen, Raumschiffe,"
echo "Definitionen, Trips). User-Accounts bleiben erhalten."
echo ""
read -p "⚠️  Neuen Cycle starten? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Abgebrochen."
  exit 1
fi

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

# ── Alles löschen außer users ─────────────────────────────────────────────

echo "🗑️   Wische alle Spieldaten (User bleiben erhalten)..."
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
-- Welt
DELETE FROM asteroid_assignments;
DELETE FROM asteroid_resource_storage;
DELETE FROM asteroid_veins;
DELETE FROM asteroids;
UPDATE spawn_slots SET station_id = NULL;
DELETE FROM spawn_slots;
-- Trips
DELETE FROM spacecraft_trips;
-- Stationen
DELETE FROM spacecraft_build_orders;
DELETE FROM station_spacecrafts;
DELETE FROM station_buildings;
DELETE FROM station_resources;
DELETE FROM stations;
-- Definitionen (werden beim API-Start neu aus game-config geseeded)
DELETE FROM spacecraft_definition_costs;
DELETE FROM spacecraft_definitions;
DELETE FROM building_definitions;

SELECT
  (SELECT COUNT(*) FROM users)               AS users_preserved,
  (SELECT COUNT(*) FROM asteroids)           AS asteroids,
  (SELECT COUNT(*) FROM stations)            AS stations,
  (SELECT COUNT(*) FROM spacecraft_definitions) AS spacecraft_defs,
  (SELECT COUNT(*) FROM building_definitions)   AS building_defs;
SQL

echo ""

# ── API neu starten → kompletter Seed läuft beim Start ───────────────────

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

# ── Ergebnis ─────────────────────────────────────────────────────────────

echo "📊  Neuer Cycle:"
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
SELECT
  (SELECT COUNT(*) FROM users)                       AS users,
  (SELECT COUNT(*) FROM asteroids)                   AS asteroids,
  (SELECT COUNT(*) FROM spacecraft_definitions)      AS spacecraft_defs,
  (SELECT COUNT(*) FROM building_definitions)        AS building_defs,
  (SELECT COUNT(*) FROM spawn_slots)                 AS spawn_slots;
SQL

echo ""
echo "✅  Neuer Cycle gestartet!"
