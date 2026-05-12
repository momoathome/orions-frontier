#!/bin/bash

# Orion's Frontier - Quick Start Script
# This script sets up and starts the entire development environment

set -e

echo "🚀 Starting Orion's Frontier Development Environment"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker is not running. Please start Docker first."
  exit 1
fi

# Check if .env exists, if not copy from .env.example
if [ ! -f .env ]; then
  echo "📝 Creating .env from .env.example..."
  cp .env.example .env
  echo "✅ .env created"
else
  echo "✓ .env already exists"
fi

echo ""
echo "🐳 Starting Docker services..."
echo ""

# Build shared packages first
echo "📦 Building shared packages..."
pnpm --filter @orions-frontier/types build
pnpm --filter @orions-frontier/shared build
pnpm --filter @orions-frontier/game-config build
echo "✅ Packages built"

echo ""
docker compose up -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 5

# Check service health
echo ""
echo "🔍 Checking service health..."

# Check Postgres
if docker compose exec -T postgres pg_isready -U orionsfrontier > /dev/null 2>&1; then
  echo "✅ PostgreSQL is ready"
else
  echo "⚠️  PostgreSQL is not ready yet (this is normal, it may need more time)"
fi

# Check Redis
if docker compose exec -T redis redis-cli ping > /dev/null 2>&1; then
  echo "✅ Redis is ready"
else
  echo "⚠️  Redis is not ready yet (this is normal, it may need more time)"
fi

echo ""
echo "✨ Development environment is starting!"
echo ""
echo "📍 Services will be available at:"
echo "   Frontend:  http://localhost:5173"
echo "   API:       http://localhost:3000"
echo "   WebSocket: ws://localhost:3001"
echo "   Health:    http://localhost:3000/api/health"
echo ""
echo "📋 Useful commands:"
echo "   docker compose logs -f        # View logs"
echo "   docker compose down           # Stop services"
echo "   docker compose restart        # Restart services"
echo ""
echo "⏳ Services may take 30-60 seconds to fully start."
echo "   Run 'docker compose logs -f' to monitor progress."
