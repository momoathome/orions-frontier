#!/bin/sh
# Usage: deploy.sh <full-commit-sha>. Backs up the database, then starts that commit's images.
set -eu
cd "$(dirname "$0")"

case "${1:-}" in
  *[!0-9a-f]* | '') echo "usage: deploy.sh <commit-sha>" >&2 && exit 2 ;;
esac
export IMAGE_TAG="$1"

docker compose -f compose.prod.yaml pull api web
# Migrations only go forward; this dump is the way back.
if [ -n "$(docker compose -f compose.prod.yaml ps -q postgres)" ]; then ./backup.sh; fi
docker compose -f compose.prod.yaml up -d --wait --wait-timeout 180
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$IMAGE_TAG/" .env
docker compose -f compose.prod.yaml ps
