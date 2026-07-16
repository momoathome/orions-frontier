#!/bin/bash
# Löscht alle Welt-Daten (Asteroiden + Spawn-Slots) und generiert die Welt neu.
# Stations, User und Definitionen werden NICHT angetastet.

set -e

echo "🌍  World Reseed"
echo ""

# ── Prüfen ob postgres läuft ───────────────────────────────────────────────

if ! docker compose ps --status running --services | grep -qx "postgres"; then
  echo "❌  PostgreSQL-Container läuft nicht. Erst starten:"
  echo "    docker compose up -d"
  exit 1
fi

if ! docker compose ps --status running --services | grep -qx "api"; then
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

POSTGRES_USER="${POSTGRES_USER:-orionsfrontier}"
POSTGRES_DB="${POSTGRES_DB:-orionsfrontier}"

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
DELETE FROM sectors;
SELECT
  (SELECT COUNT(*) FROM asteroids)                 AS asteroids,
  (SELECT COUNT(*) FROM asteroid_veins)            AS veins,
  (SELECT COUNT(*) FROM asteroid_resource_storage) AS storage,
  (SELECT COUNT(*) FROM spawn_slots)               AS spawn_slots;
SQL

echo ""

# ── API neu starten → World-Gen läuft beim Start automatisch ─────────────

echo "🔄  Starte API neu (World-Gen läuft beim Start automatisch)..."
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

echo "📊  World Generation Stats (aus API-Log):"
docker compose logs api --since 90s --no-log-prefix 2>/dev/null \
  | grep -v '^\s*$' \
  | grep -A 60 'World Generation' \
  | head -70

echo ""
echo "✅  Welt neu generiert!"
