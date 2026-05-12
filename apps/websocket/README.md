# WebSocket Documentation

## Overview

WebSocket-Server für Realtime-Kommunikation in Orion's Frontier.

## Connection

```javascript
const ws = new WebSocket('ws://localhost:3001');
```

## Message Format

Alle Nachrichten folgen diesem Schema:

```typescript
interface WsMessage {
  type: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}
```

## Events

### Connection

**Server → Client** (bei Verbindungsaufbau)

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

**Client → Server**
```json
{
  "type": "ping",
  "timestamp": 1234567890
}
```

**Server → Client**
```json
{
  "type": "pong",
  "timestamp": 1234567890
}
```

### Error

**Server → Client**
```json
{
  "type": "error",
  "timestamp": 1234567890,
  "payload": {
    "message": "Error description"
  }
}
```

## Connection Health

Der Server sendet automatisch Pings alle 30 Sekunden.
Clients müssen mit Pong antworten, sonst wird die Verbindung getrennt.

## Authentication

> Auth-System wird in Phase 2 implementiert.

## Game Events

> Gameplay-Events werden in Phase 2 implementiert.
