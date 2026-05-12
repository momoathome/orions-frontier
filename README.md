# Orion's Frontier - TypeScript Monorepo

Moderne TypeScript-basierte Browsergame-Infrastruktur mit Fastify, Vue 3, und PostgreSQL.

## 🚀 Quick Start

### Voraussetzungen

- Docker & Docker Compose
- Node.js >= 20 (für lokale Entwicklung ohne Docker)
- pnpm >= 9.0.0

### Projekt starten (Docker)

1. **Environment-Variablen einrichten:**
   ```bash
   cp .env.example .env
   ```

2. **Dependencies installieren & Packages bauen:**
   ```bash
   pnpm install
   pnpm --filter @orions-frontier/types build
   pnpm --filter @orions-frontier/shared build
   pnpm --filter @orions-frontier/game-config build
   ```

3. **Services starten:**
   ```bash
   docker compose up -d
   ```

4. **Datenbank initialisieren (beim ersten Start):**
   ```bash
   docker compose exec api sh -c "cd /app/apps/api && pnpm db:migrate"
   ```

5. **Zugriff auf die Anwendung:**
   - Frontend: http://localhost:5173
   - API: http://localhost:3000
   - WebSocket: ws://localhost:3001
   - API Health: http://localhost:3000/api/v1/health

**Quick Start (Alternative):**
```bash
./scripts/start-dev.sh
docker compose exec api sh -c "cd /app/apps/api && pnpm db:migrate"
```

### Projekt stoppen

```bash
docker compose down
```

### Logs anzeigen

```bash
docker compose logs -f
```

## 🏗️ Architektur

```
orions-frontier/
├── apps/
│   ├── api/              # Fastify API Server
│   ├── websocket/        # WebSocket Server
│   └── frontend/         # Vue 3 Frontend
├── packages/
│   ├── types/            # Gemeinsame TypeScript Types & DTOs
│   ├── shared/           # Gemeinsame Utilities & Helpers
│   ├── game-config/      # Game-Konfiguration & Balancing
│   └── utils/            # Utility-Funktionen
└── docker-compose.yml    # Docker Orchestrierung
```

## 🛠️ Tech Stack

### Backend
- **Fastify** - Schneller Web-Framework
- **Drizzle ORM** - TypeScript-first ORM
- **PostgreSQL** - Hauptdatenbank
- **Redis** - Caching & Queue-System
- **Zod** - Schema-Validation
- **WebSockets** - Realtime-Kommunikation

### Frontend
- **Vue 3** - Composition API
- **Vite** - Build-Tool & Dev-Server
- **Pinia** - State Management
- **Vue Router** - Routing
- **TanStack Query** - Data Fetching & Caching
- **Axios** - HTTP Client

### Infrastructure
- **Docker** - Containerisierung
- **pnpm** - Package Manager & Workspaces
- **TypeScript** - Vollständige Type-Safety

## 📦 Verfügbare Packages

### `@orions-frontier/types`
Gemeinsame TypeScript-Types, DTOs und Zod-Schemas für Frontend & Backend.

```typescript
import { UserSchema, CreateUserSchema } from '@orions-frontier/types';
```

### `@orions-frontier/shared`
Gemeinsame Utilities, Error-Handling und Konstanten.

```typescript
import { Result, AppError, ErrorCode } from '@orions-frontier/shared';
```

### `@orions-frontier/game-config`
Game-Konfiguration, Balancing und Konstanten.

```typescript
import { BUILDINGS, SPACECRAFTS, GAME_CONFIG } from '@orions-frontier/game-config';
```

## 🔧 Lokale Entwicklung (ohne Docker)

### 1. Dependencies installieren

```bash
pnpm install
```

### 2. PostgreSQL & Redis starten

```bash
# Mit Docker nur für Datenbanken
docker compose up -d postgres redis
```

### 3. Environment-Variablen anpassen

Für lokale Entwicklung in `.env`:
```env
DATABASE_URL=postgresql://orionsfrontier:orionsfrontier@localhost:5432/orionsfrontier
REDIS_URL=redis://localhost:6379
```

### 4. Database Migrations ausführen

```bash
cd apps/api
pnpm db:generate
pnpm db:migrate
```

### 5. Services starten

```bash
# Alle Services gleichzeitig
pnpm dev

# Oder einzeln
pnpm --filter @orions-frontier/api dev
pnpm --filter @orions-frontier/websocket dev
pnpm --filter @orions-frontier/frontend dev
```

## 📝 Verfügbare Scripts

### Root-Level

```bash
pnpm dev              # Alle Services im Dev-Mode
pnpm build            # Alle Packages & Apps bauen
pnpm typecheck        # TypeScript-Checks durchführen
pnpm lint             # ESLint ausführen
pnpm format           # Code formatieren (Prettier)
pnpm clean            # Build-Artefakte löschen
```

### API-spezifisch

```bash
cd apps/api
pnpm dev              # Dev-Server starten
pnpm build            # Production-Build
pnpm db:generate      # Drizzle Migrations generieren
pnpm db:migrate       # Migrations ausführen
pnpm db:studio        # Drizzle Studio öffnen
```

### Frontend-spezifisch

```bash
cd apps/frontend
pnpm dev              # Dev-Server starten
pnpm build            # Production-Build
pnpm preview          # Production-Preview
```

## 🗄️ Datenbank

### Migrations erstellen

1. Schema in `apps/api/src/lib/db/schema/` anpassen
2. Migration generieren:
   ```bash
   cd apps/api
   pnpm db:generate
   ```
3. Migration ausführen:
   ```bash
   pnpm db:migrate
   ```

### Drizzle Studio

```bash
cd apps/api
pnpm db:studio
```

Öffnet eine Web-UI zum Durchsuchen der Datenbank.

## 🔌 API Endpoints

### Health Check

```
GET /api/v1/health
```

Prüft die Verfügbarkeit aller Services (Database, Redis).

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-05-12T10:00:00.000Z",
  "services": {
    "database": "ok",
    "redis": "ok"
  }
}
```

## 🌐 WebSocket Events

### Connection

Der WebSocket-Server akzeptiert Verbindungen auf `ws://localhost:3001`.

**Connection Message:**
```json
{
  "type": "connection",
  "timestamp": 1234567890,
  "payload": {
    "message": "Connected to Orions Frontier WebSocket server"
  }
}
```

### Ping/Pong

**Client → Server:**
```json
{
  "type": "ping",
  "timestamp": 1234567890
}
```

**Server → Client:**
```json
{
  "type": "pong",
  "timestamp": 1234567890
}
```

## 📐 Projektstruktur

### API (`apps/api/`)

```
apps/api/
├── src/
│   ├── modules/          # Feature-Module
│   │   └── health/       # Health-Check-Modul
│   ├── plugins/          # Fastify-Plugins
│   │   └── error-handler.ts
│   ├── lib/              # Bibliotheken
│   │   ├── db/           # Drizzle-Konfiguration
│   │   ├── logger.ts     # Logger-Setup
│   │   └── redis.ts      # Redis-Client
│   ├── config/           # Konfiguration
│   │   └── env.ts        # Environment-Schema
│   └── index.ts          # Entry Point
├── drizzle.config.ts     # Drizzle-Konfiguration
└── package.json
```

### WebSocket (`apps/websocket/`)

```
apps/websocket/
├── src/
│   ├── handlers/         # WebSocket-Event-Handler
│   │   └── connection.ts
│   ├── lib/
│   │   └── logger.ts
│   └── index.ts          # Entry Point
└── package.json
```

### Frontend (`apps/frontend/`)

```
apps/frontend/
├── src/
│   ├── views/            # Vue-Views
│   ├── stores/           # Pinia-Stores
│   ├── router/           # Vue-Router-Konfiguration
│   ├── lib/              # Bibliotheken
│   │   ├── api-client.ts # Axios-Setup
│   │   └── ws-client.ts  # WebSocket-Client
│   ├── App.vue
│   ├── main.ts
│   └── style.css
├── index.html
├── vite.config.ts
└── package.json
```

## 🧪 Testing

> Testing-Setup wird in einer späteren Phase implementiert.

## 🚢 Deployment

> Deployment-Konfiguration wird in einer späteren Phase implementiert.

## 📋 Akzeptanzkriterien (ORI-5)

- ✅ Monorepo läuft lokal via Docker Compose
- ✅ API startet erfolgreich
- ✅ Frontend startet erfolgreich
- ✅ PostgreSQL Verbindung funktioniert
- ✅ Redis Verbindung funktioniert
- ✅ WebSocket-Verbindung möglich
- ✅ Shared Packages funktionieren workspace-übergreifend
- ✅ TypeScript strict mode aktiviert
- ✅ ESLint + Prettier eingerichtet
- ✅ Environment Validation vorhanden
- ✅ Health Endpoint verfügbar
- ✅ Hot Reloading funktioniert für alle Services
- ✅ Basis-README für lokalen Projektstart vorhanden

## 🎯 Nächste Schritte

Diese Phase hat die technische Grundlage geschaffen. In den nächsten Phasen:

1. **Authentication & Authorization** - JWT, Sessions, User-Management
2. **Game-Features** - Mining, Combat, Queue-Processing
3. **Realtime-Updates** - WebSocket-Events für Gameplay
4. **Admin-Panel** - Verwaltungsoberfläche
5. **Testing** - Unit-, Integration- und E2E-Tests
6. **CI/CD** - Automatisierte Deployments

## 🤝 Entwicklung

### Code-Style

- TypeScript Strict Mode
- ESLint + Prettier
- Functional Programming bevorzugt
- Domain-orientierte Struktur

### Git Workflow

> Wird in einer späteren Phase definiert.

## 📄 Lizenz

> TBD

## 🐛 Troubleshooting

### Docker-Container starten nicht

```bash
# Container neu bauen
docker compose up -d --build

# Volumes löschen und neu starten
docker compose down -v
docker compose up -d
```

### Port bereits belegt

Passen Sie die Ports in `.env` an:
```env
API_PORT=3000
WS_PORT=3001
```

### pnpm Install-Fehler

```bash
# Cache löschen
pnpm store prune

# Neu installieren
pnpm install --force
```

## 📞 Support

Bei Fragen oder Problemen bitte ein Issue im Repository erstellen.
