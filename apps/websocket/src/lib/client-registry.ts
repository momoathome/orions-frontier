import type { WebSocket } from 'ws';

const clients = new Map<string, Set<WebSocket>>();

export const registerClient = (userId: string, ws: WebSocket): void => {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId)!.add(ws);
};

export const unregisterClient = (userId: string, ws: WebSocket): void => {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) clients.delete(userId);
};

export const getClients = (userId: string): Set<WebSocket> => clients.get(userId) ?? new Set();
