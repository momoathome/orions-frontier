#!/bin/bash

# Reset the entire development environment

set -e

echo "🔄 Resetting Orion's Frontier development environment..."
echo ""

read -p "⚠️  This will delete all data. Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Cancelled."
  exit 1
fi

echo ""
echo "🛑 Stopping services..."
docker compose down -v

echo ""
echo "🗑️  Removing node_modules..."
rm -rf node_modules
rm -rf apps/*/node_modules
rm -rf packages/*/node_modules

echo ""
echo "🗑️  Removing build artifacts..."
rm -rf apps/*/dist
rm -rf packages/*/dist

echo ""
echo "📦 Reinstalling dependencies..."
pnpm install

echo ""
echo "✅ Reset complete!"
echo ""
echo "To start again, run: ./scripts/start-dev.sh"
