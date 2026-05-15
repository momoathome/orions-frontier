# Orion's Frontier - Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                             │
│                      (Vue 3 + Vite)                         │
│                    Port: 5173                                │
└────────────┬──────────────────────────┬─────────────────────┘
             │                          │
             │ HTTP/REST                │ WebSocket
             │                          │
┌────────────▼──────────────┐  ┌────────▼────────────────────┐
│         API Server         │  │   WebSocket Server          │
│      (Fastify)             │  │       (ws)                  │
│      Port: 3000            │  │      Port: 3001             │
└────────────┬───────────────┘  └─────────────────────────────┘
             │
             │
    ┌────────┴────────┐
    │                 │
┌───▼────┐      ┌────▼─────┐
│PostgreSQL│      │  Redis   │
│Port: 5432│      │Port: 6379│
└──────────┘      └──────────┘
```

## Monorepo Structure

```
orions-frontier/
├── apps/
│   ├── api/                    # Fastify REST API
│   │   ├── src/
│   │   │   ├── modules/        # Feature modules
│   │   │   ├── plugins/        # Fastify plugins
│   │   │   ├── lib/            # Libraries (db, redis, logger)
│   │   │   ├── config/         # Configuration
│   │   │   └── index.ts        # Entry point
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── websocket/              # WebSocket Server
│   │   ├── src/
│   │   │   ├── handlers/       # WS event handlers
│   │   │   ├── lib/            # Libraries
│   │   │   └── index.ts        # Entry point
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── frontend/               # Vue 3 SPA
│       ├── src/
│       │   ├── views/          # Vue views
│       │   ├── stores/         # Pinia stores
│       │   ├── router/         # Vue Router
│       │   ├── lib/            # Libraries (api, ws)
│       │   ├── App.vue
│       │   └── main.ts
│       ├── index.html
│       ├── vite.config.ts
│       ├── Dockerfile
│       └── package.json
│
├── packages/
│   ├── types/                  # Shared TypeScript types
│   │   ├── src/
│   │   │   └── index.ts        # DTOs, Zod schemas
│   │   └── package.json
│   │
│   ├── shared/                 # Shared utilities
│   │   ├── src/
│   │   │   └── index.ts        # Result types, errors, utils
│   │   └── package.json
│   │
│   └── game-config/            # Game configuration
│       ├── src/
│       │   └── index.ts        # Buildings, spacecrafts, balancing
│       └── package.json
│
├── scripts/                    # Helper scripts
│   ├── start-dev.sh
│   ├── stop-dev.sh
│   └── reset.sh
│
├── .vscode/                    # VSCode configuration
│   ├── extensions.json
│   └── settings.json
│
├── docker-compose.yml          # Docker orchestration
├── pnpm-workspace.yaml         # pnpm workspace config
├── tsconfig.base.json          # Base TypeScript config
├── .eslintrc.cjs               # ESLint config
├── .prettierrc                 # Prettier config
├── .env                        # Environment variables
├── .gitignore
├── README.md
├── CHANGELOG.md
└── CONTRIBUTING.md
```

## Data Flow

### HTTP Request Flow

```
Frontend → API Client (Axios)
              ↓
          API Server (Fastify)
              ↓
          Route Handler
              ↓
          Business Logic
              ↓
       Database (Drizzle ORM)
              ↓
          PostgreSQL
```

### WebSocket Flow

```
Frontend → WebSocket Client
              ↓
          WebSocket Server
              ↓
          Connection Handler
              ↓
          Event Handler
              ↓
          Business Logic (future)
```

## Type Safety Flow

```
packages/types/
    └── DTOs (Zod schemas)
          ↓
    ┌─────┴─────┐
    ↓           ↓
  API       Frontend
  (validates  (validates
   requests)   responses)
```

## Technology Stack

### Backend Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | Fastify | Fast web framework |
| **ORM** | Drizzle | Type-safe database queries |
| **Database** | PostgreSQL | Primary data store |
| **Cache** | Redis | Caching & sessions |
| **Validation** | Zod | Schema validation |
| **WebSocket** | ws | Realtime communication |
| **Logger** | Pino | Structured logging |

### Frontend Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | Vue 3 | UI framework |
| **Build Tool** | Vite | Fast development & build |
| **State** | Pinia | State management |
| **Routing** | Vue Router | Client-side routing |
| **Data Fetching** | TanStack Query | Server state management |
| **HTTP** | Axios | API client |
| **Types** | TypeScript | Type safety |

### Infrastructure

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Monorepo** | pnpm workspaces | Package management |
| **Containers** | Docker | Service isolation |
| **Orchestration** | Docker Compose | Local development |
| **Language** | TypeScript | Type safety |
| **Linting** | ESLint | Code quality |
| **Formatting** | Prettier | Code style |

## Key Design Decisions

### 1. Monorepo Architecture
- **Why**: Shared types, simplified dependencies, atomic changes
- **Tool**: pnpm workspaces (fast, efficient)
- **Structure**: Domain-oriented (apps + packages)

### 2. Type Safety
- **End-to-End**: Frontend ↔ Shared Types ↔ Backend
- **Runtime Validation**: Zod schemas
- **Compile-Time**: TypeScript strict mode
- **Benefits**: Fewer runtime errors, better DX

### 3. Separated WebSocket Service
- **Why**: Independent scaling, clear separation of concerns
- **Trade-off**: More complexity vs better scalability
- **Future**: Can be scaled independently from API

### 4. Docker-First Development
- **Why**: Reproducible environments, production parity
- **Benefits**: Easy onboarding, consistent across team
- **Trade-off**: Slightly slower than native development

### 5. Functional Programming
- **Result Types**: Instead of throwing errors
- **Immutability**: Preferred where possible
- **Pure Functions**: Business logic
- **Benefits**: Easier to test, reason about, debug

## Configuration Management

### Environment Variables

```
┌─────────────┐
│  .env.example  │  ← Template (committed)
└────────┬──────┘
         │
         ↓ (copy)
    ┌────────┐
    │  .env  │  ← Local (gitignored)
    └────┬───┘
         │
         ↓ (loaded by)
    ┌────────────────┐
    │ Docker Compose │
    │   or           │
    │ Node.js Apps   │
    └────────────────┘
```

### Configuration Layers

1. **Base Config**: `tsconfig.base.json`, `.eslintrc.cjs`
2. **App Config**: Each app extends base config
3. **Environment**: `.env` for runtime config
4. **Validation**: Zod schemas validate env vars at startup

## Security Considerations

### Current State (Phase 1)
- ✅ Helmet (security headers)
- ✅ CORS configuration
- ✅ Environment validation
- ⚠️ Auth: To be implemented (Phase 2)
- ⚠️ Rate limiting: To be implemented
- ⚠️ Input sanitization: Partial (Zod validation)

### Planned (Future Phases)
- JWT authentication
- Session management
- Role-based access control
- Rate limiting
- Request sanitization
- SQL injection prevention (Drizzle handles this)

## Performance Considerations

### Current Optimizations
- **Fastify**: Fast by design
- **Drizzle**: Efficient queries
- **Redis**: Caching layer ready
- **Vite**: Fast HMR
- **pnpm**: Fast package management

### Future Optimizations
- API response caching
- Database query optimization
- CDN for static assets
- Service worker for offline support
- Code splitting (Vite automatic)

## Scalability

### Current Architecture
```
Single Node
├── API (can scale horizontally)
├── WebSocket (can scale with sticky sessions)
├── PostgreSQL (vertical scaling)
└── Redis (can cluster)
```

### Future Scaling Path
```
Load Balancer
    ↓
Multiple API Instances
    ↓
Multiple WebSocket Instances (sticky sessions)
    ↓
PostgreSQL Primary + Replicas
    ↓
Redis Cluster
```

## Development Workflow

### 1. Start Development
```bash
./scripts/start-dev.sh
# or
docker compose up -d
```

### 2. Make Changes
- Code changes auto-reload (HMR)
- TypeScript validates on save
- ESLint runs on save (VSCode)

### 3. Test Locally
- Frontend: http://localhost:5173
- API: http://localhost:3000/api/health
- Database: Via Drizzle Studio

### 4. Commit
```bash
git add .
git commit -m "feat: add feature"
```

## Testing Strategy (Future)

### Planned Testing Layers
1. **Unit Tests**: Business logic
2. **Integration Tests**: API endpoints
3. **E2E Tests**: Critical user flows
4. **Contract Tests**: API contracts

### Tools (Planned)
- Vitest (unit tests)
- Supertest (API tests)
- Playwright (E2E tests)

## Deployment Strategy (Future)

### Planned Environments
1. **Development**: Docker Compose (current)
2. **Staging**: Kubernetes cluster
3. **Production**: Kubernetes cluster

### CI/CD Pipeline (Planned)
```
GitHub Actions
    ↓
Lint + Type Check
    ↓
Build All Apps
    ↓
Run Tests
    ↓
Build Docker Images
    ↓
Push to Registry
    ↓
Deploy to Kubernetes
```

## Monitoring & Observability (Future)

### Planned
- **Logs**: Centralized logging (ELK/Loki)
- **Metrics**: Prometheus + Grafana
- **Tracing**: OpenTelemetry
- **Errors**: Sentry
- **Health**: `/health` endpoints

## Next Steps

See [README.md](README.md) for immediate next steps and Phase 2 planning.
