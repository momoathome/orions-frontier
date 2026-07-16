#!/bin/bash
# Spielt geänderte Spacecraft- und Building-Definitionen aus game-config neu ein.
# Stations, Asteroiden und User werden NICHT angetastet.

set -e

echo "📋  Definition Reseed"
echo ""

# ── Prüfen ob postgres läuft ───────────────────────────────────────────────

if ! docker compose ps --status running --services | grep -qx "api"; then
  echo "❌  API-Container läuft nicht. Erst starten:"
  echo "    docker compose up -d"
  exit 1
fi

# ── API neu starten → Seed aktualisiert Definitionen automatisch ──────────

echo "🔄  Starte API neu (Definitions-Seed läuft beim Start automatisch)..."
docker compose up -d --build api

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

echo "✅  Definitionen aktualisiert!"
