#!/bin/bash

# Initialize database with migrations

set -e

echo "🗄️  Initializing database..."
echo ""

# Check if API container is running
if ! docker ps | grep -q orions-frontier-api; then
  echo "❌ API container is not running. Please start services first with:"
  echo "   ./scripts/start-dev.sh"
  exit 1
fi

echo "📝 Generating migrations..."
docker compose exec api pnpm db:generate

echo ""
echo "⚡ Running migrations..."
docker compose exec api pnpm db:migrate

echo ""
echo "✅ Database initialized!"
echo ""
echo "Check health: curl http://localhost:3000/api/v1/health"
