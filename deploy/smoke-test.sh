#!/bin/sh
# Boots the production images against an empty database, behind Caddy on https://localhost.
set -eu
cd "$(dirname "$0")/.."

export IMAGE_TAG=smoke DOMAIN=localhost POSTGRES_USER=smoke POSTGRES_DB=smoke
export POSTGRES_PASSWORD="$(openssl rand -hex 16)" JWT_SECRET="$(openssl rand -hex 32)"
export WORLD_SEED="$(openssl rand -hex 16)" ADMIN_EMAIL=admin@smoke.test
export ADMIN_PASSWORD="$(openssl rand -hex 16)"
compose="docker compose -f compose.prod.yaml -p orions-frontier-smoke --env-file /dev/null"
base=https://localhost
dump="$(mktemp)"

fail() {
  echo "FAILED: $1" >&2
  exit 1
}

for target in api web; do
  docker build --target "$target" --build-arg PUBLIC_DOMAIN=localhost \
    -t "ghcr.io/momoathome/orions-frontier-$target:smoke" .
done

cleanup() {
  [ "$?" -eq 0 ] || $compose logs --tail 50
  $compose down --volumes
  rm -f "$dump"
}
trap cleanup EXIT

$compose up -d --no-build --pull missing --wait --wait-timeout 180

curl -fsSk "$base/api/health" >/dev/null || fail "api through Caddy"
curl -fsSk "$base/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" >/dev/null || fail "admin login"
curl -fsSk "$base/" | grep -q 'wss://localhost' || fail "CSP without socket origin"
curl -fsSkI "$base/some/app/route" | grep -qi '^x-frame-options: DENY' || fail "app fallback headers"

# curl times out once the socket stays open; the 101 is what counts.
status="$(curl -sSk --http1.1 --max-time 3 -o /dev/null -w '%{http_code}' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "$base/ws" || true)"
[ "$status" = 101 ] || fail "websocket upgrade returned $status"

migrations="$($compose exec -T postgres psql -U smoke -d smoke -Atc \
  'select count(*) from drizzle.__drizzle_migrations')"
[ "$migrations" -gt 0 ] || fail "no migrations applied"

$compose restart api
$compose up -d --no-build --pull missing --wait --wait-timeout 120
curl -fsSk "$base/api/health" >/dev/null || fail "api after restart"

$compose exec -T postgres pg_dump -U smoke -Fc smoke >"$dump"
$compose exec -T postgres pg_restore --list <"$dump" | grep -q 'TABLE' || fail "backup not readable"

echo "smoke test passed ($migrations migrations)"
