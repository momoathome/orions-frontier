#!/bin/bash

# Initialize database with migrations

set -e

echo "🗄️  Initializing database..."
echo ""

# Check if API container is running
if ! docker ps | grep -q orions-frontier-api; then
  echo "❌ API container is not running. Please start services first with:"
  echo "   docker compose up -d"
  exit 1
fi

echo "⚡ Running migrations..."
docker compose exec api pnpm --filter @orions-frontier/api db:migrate

echo ""
echo "✅ Database initialized!"
echo ""
echo "Check health: curl http://localhost:3000/api/health"
