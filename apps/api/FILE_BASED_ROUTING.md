# File-Based Routing

Dieses Fastify-Backend nutzt `@fastify/autoload` für automatisches, dateibasiertes Routing.

## Grundprinzip

Die **Ordnerstruktur** unter `src/routes/` bestimmt die URLs — nicht die Dateinamen.

## URL-Berechnung

**Formel:** `Vollständige URL = /api + Ordnerpfad + Pfad im Route-File`

### Beispiele

| File | Pfad im File | Resultierende URL |
|------|--------------|-------------------|
| `routes/health/get-health.ts` | `app.get("/", ...)` | `GET /api/health` |
| `routes/users/get-users.ts` | `app.get("/", ...)` | `GET /api/users` |
| `routes/users/_id/get-user.ts` | `app.get("/", ...)` | `GET /api/users/:id` |

> **Wichtig:** Der Pfad im File ist fast immer `"/"` — die URL ergibt sich aus der Ordnerstruktur!

## URL-Parameter mit `_`-Prefix

Ordnernamen mit `_`-Prefix werden automatisch zu URL-Parametern:

```
routes/
  users/
    _id/           → /api/users/:id
      get-user.ts
    _username/     → /api/users/:username
      get-by-username.ts
```

## Dateinamen-Konvention

Format: `{http-methode}-{ressource}.ts`

**Beispiele:**
- `get-users.ts` — Liste abrufen
- `get-user.ts` — Einzelne Ressource abrufen
- `post-user.ts` — Neue Ressource erstellen
- `patch-user.ts` — Ressource aktualisieren
- `delete-user.ts` — Ressource löschen

> Die Dateinamen beeinflussen die URL **nicht**, sie dienen nur der Lesbarkeit!

## Aufbau eines Route-Files

Jedes Route-File exportiert genau **eine Route** als `default export`:

```typescript
import { defineRoute } from '../../lib/route-helper.js';

/**
 * Get single user by ID
 * GET /api/users/:id
 */
export default defineRoute(async (app) => {
  app.get('/', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    return reply.send({
      user: { id, username: `user-${id}` }
    });
  });
});
```

## `defineRoute`-Helper

Der `defineRoute`-Helper ist ein reiner **Type-Wrapper** ohne Laufzeit-Logik. Er ermöglicht:
- Bessere TypeScript-Inferenz
- IDE-Autovervollständigung
- Verwendung von `fastify-plugin` unter der Haube

```typescript
export const defineRoute = (plugin: FastifyPluginAsync): FastifyPluginAsync => {
  return fp(plugin);
};
```

## AutoLoad-Konfiguration

In `src/index.ts` ist AutoLoad wie folgt konfiguriert:

```typescript
await fastify.register(autoload, {
  dir: join(__dirname, 'routes'),
  options: {
    prefix: '/api',
  },
  dirNameRoutePrefix: true,  // Ordnernamen werden zu URL-Prefixes
  routeParams: true,          // _param Ordner werden zu :param URL-Parametern
});
```

## Verzeichnisstruktur

```
src/
  routes/
    health/
      get-health.ts          → GET /api/health
    users/
      get-users.ts           → GET /api/users
      post-user.ts           → POST /api/users
      _id/
        get-user.ts          → GET /api/users/:id
        patch-user.ts        → PATCH /api/users/:id
        delete-user.ts       → DELETE /api/users/:id
```

## Best Practices

1. **Ein File = Ein Endpoint** — Jedes File enthält genau eine HTTP-Methode für einen Pfad
2. **Pfad immer `"/"`** — Nutze die Ordnerstruktur für die URL
3. **Business-Logik in Services** — Handler bleiben schlank, Logik gehört in separate Service-Files
4. **TypeScript nutzen** — Typisiere `request.params`, `request.body` etc.
5. **Validation mit Zod** — Nutze Fastify's Schema-Validation für Request/Response

## Nächste Schritte

- [ ] Integration mit Zod-Schema-Validation (`fastify-type-provider-zod`)
- [ ] Service-Layer für Business-Logik
- [ ] Auth-Middleware für geschützte Routes
- [ ] OpenAPI/Swagger-Dokumentation
