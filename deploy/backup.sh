#!/bin/sh
# Writes a compressed database dump to backups/ and keeps the last 14 days.
set -eu
cd "$(dirname "$0")"

mkdir -p backups
file="backups/orions-$(date -u +%Y%m%dT%H%M%SZ).dump"
# Written under a temporary name so a failed dump never looks like a valid backup.
docker compose -f compose.prod.yaml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' >"$file.tmp"
mv "$file.tmp" "$file"
find backups -name 'orions-*.dump' -mtime +14 -delete
echo "$file"
