# Frontend Documentation

## Overview

Vue 3-basiertes Frontend für Orion's Frontier.

## Tech Stack

- Vue 3 (Composition API)
- Vite
- TypeScript
- Pinia (State Management)
- Vue Router
- TanStack Query
- Axios

## Development

```bash
pnpm dev
```

Öffnet den Dev-Server auf http://localhost:5173

## Project Structure

```
src/
├── views/          # Vue Views/Pages
├── components/     # Vue Components (wird in Phase 2 erstellt)
├── stores/         # Pinia Stores
├── router/         # Vue Router Config
├── lib/            # Libraries & Utils
│   ├── api-client.ts
│   └── ws-client.ts
├── App.vue
├── main.ts
└── style.css
```

## API Client

Der API-Client ist in `src/lib/api-client.ts` konfiguriert.

### Usage

```typescript
import { apiClient } from '@/lib/api-client';

const response = await apiClient.get('/health');
```

### Authentication

Der API-Client fügt automatisch den Auth-Token hinzu:

```typescript
// Token wird aus localStorage gelesen
const token = localStorage.getItem('auth_token');
```

## WebSocket Client

Der WebSocket-Client ist in `src/lib/ws-client.ts` konfiguriert.

### Usage

```typescript
import { wsClient } from '@/lib/ws-client';

// Connect
wsClient.connect();

// Send message
wsClient.send({
  type: 'ping',
  timestamp: Date.now(),
});

// Disconnect
wsClient.disconnect();
```

## State Management

Pinia-Stores befinden sich in `src/stores/`.

### Auth Store

```typescript
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();

// Login (wird in Phase 2 implementiert)
await authStore.login(email, password);

// Logout
authStore.logout();

// Check auth
authStore.checkAuth();
```

## Routing

Routes sind in `src/router/index.ts` definiert.

### Protected Routes

```typescript
{
  path: '/dashboard',
  meta: { requiresAuth: true }
}
```

## Environment Variables

Environment-Variablen werden über Vite injiziert:

```typescript
const apiUrl = import.meta.env.VITE_API_URL;
const wsUrl = import.meta.env.VITE_WS_URL;
```

## Build

```bash
pnpm build
```

Output: `dist/`

## Preview Production Build

```bash
pnpm preview
```
