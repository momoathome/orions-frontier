# API Documentation

## Overview

Fastify-basierte REST API für Orion's Frontier.

## Base URL

```
http://localhost:3000/api/v1
```

## Authentication

> Auth-System wird in Phase 2 implementiert.

## Endpoints

### Health Check

**GET** `/health`

Prüft den Status aller Services.

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

**Status Codes:**
- `200 OK` - Alle Services funktionieren
- `503 Service Unavailable` - Ein oder mehrere Services sind nicht erreichbar

## Error Handling

Alle API-Fehler folgen diesem Schema:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": {}
  }
}
```

### Error Codes

| Code | Status | Beschreibung |
|------|--------|--------------|
| `UNAUTHORIZED` | 401 | Nicht authentifiziert |
| `FORBIDDEN` | 403 | Keine Berechtigung |
| `NOT_FOUND` | 404 | Ressource nicht gefunden |
| `VALIDATION_ERROR` | 400 | Validierungsfehler |
| `INTERNAL_ERROR` | 500 | Serverfehler |

## Rate Limiting

> Wird in einer späteren Phase implementiert.

## Versioning

Die API verwendet URL-basiertes Versioning (`/api/v1/`).
