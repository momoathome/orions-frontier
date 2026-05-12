#!/bin/bash

# Stop all services and clean up

set -e

echo "🛑 Stopping Orion's Frontier services..."

docker compose down

echo "✅ All services stopped"
echo ""
echo "💡 To remove volumes (database data), run:"
echo "   docker compose down -v"
