# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-05-12

### Added

#### Infrastructure
- TypeScript Monorepo mit pnpm workspaces
- Docker Compose Setup für lokale Entwicklung
- Shared TypeScript-Konfiguration (tsconfig.base.json)
- ESLint + Prettier für Code-Qualität
- Environment Validation mit Zod

#### Apps
- **API**: Fastify-basierter REST API Server
  - Health-Endpoint
  - Drizzle ORM Integration mit PostgreSQL
  - Redis Client
  - Error Handling Plugin
  - Environment Validation
  - Logging mit Pino
  
- **WebSocket**: Standalone WebSocket Server
  - Connection Lifecycle Management
  - Ping/Pong Health Checks
  - Event-basierte Architektur
  - Auto-Reconnect Logic
  
- **Frontend**: Vue 3 SPA
  - Vite Build Tool
  - Vue Router
  - Pinia State Management
  - TanStack Query Integration
  - API Client (Axios)
  - WebSocket Client
  - Auth Store (Basis)

#### Packages
- **@orions-frontier/types**: Gemeinsame TypeScript Types & DTOs mit Zod
- **@orions-frontier/shared**: Utilities, Error-Handling, Constants
- **@orions-frontier/game-config**: Game-Konfiguration & Balancing-Werte

#### Docker
- PostgreSQL 16 mit Health Checks
- Redis 7 mit Health Checks
- Hot Reloading für alle Services
- Persistent Volumes für Datenbanken

#### Documentation
- README mit Schnellstart-Anleitung
- API Documentation
- WebSocket Documentation
- Frontend Documentation

### Technical Details
- TypeScript Strict Mode aktiviert
- End-to-End Type-Safety zwischen Frontend & Backend
- Monorepo-Architektur mit Workspace-Referenzen
- Domain-orientierte Struktur
- Funktionale Programmierung bevorzugt

### Infrastructure
- Node.js 20
- pnpm 9
- Docker & Docker Compose
- PostgreSQL 16
- Redis 7
