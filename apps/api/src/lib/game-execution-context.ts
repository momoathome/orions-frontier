import { createHash, randomUUID } from 'node:crypto';
import { worldSeed as readWorldSeed } from './world-config.js';

export interface GameExecutionContext {
  readonly now: Date;
  readonly worldSeed: string;
  nextId(namespace: string): string;
  at(now: Date): GameExecutionContext;
}

export interface SeededExecutionContextOptions {
  now: Date;
  seed: string;
  worldSeed?: string;
}

interface IdSequence {
  next(namespace: string): string;
}

function assertNamespace(namespace: string): void {
  if (namespace.trim().length === 0) {
    throw new Error('ID namespace must not be empty');
  }
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function createDeterministicIdSequence(seed: string): IdSequence {
  let counter = 0;

  return {
    next(namespace: string): string {
      assertNamespace(namespace);
      const sequenceNumber = counter++;
      const bytes = createHash('sha256')
        .update(seed)
        .update('\0')
        .update(namespace)
        .update('\0')
        .update(String(sequenceNumber))
        .digest()
        .subarray(0, 16);

      // RFC 4122 variant with a name-based (version 5) UUID marker.
      bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
      bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
      return formatUuid(bytes);
    },
  };
}

function createContext(now: Date, worldSeed: string, ids: IdSequence): GameExecutionContext {
  return {
    now: new Date(now),
    worldSeed,
    nextId(namespace: string): string {
      return ids.next(namespace);
    },
    at(nextNow: Date): GameExecutionContext {
      return createContext(nextNow, worldSeed, ids);
    },
  };
}

export function createRealtimeExecutionContext(
  now = new Date(),
  worldSeed = readWorldSeed()
): GameExecutionContext {
  const ids: IdSequence = {
    next(namespace: string): string {
      assertNamespace(namespace);
      return randomUUID();
    },
  };
  return createContext(now, worldSeed, ids);
}

export function createSeededExecutionContext(
  options: SeededExecutionContextOptions
): GameExecutionContext {
  if (!Number.isFinite(options.now.getTime())) {
    throw new Error('Seeded execution context requires a valid start time');
  }
  if (options.seed.length === 0) {
    throw new Error('Seeded execution context requires a non-empty seed');
  }

  return createContext(
    options.now,
    options.worldSeed ?? options.seed,
    createDeterministicIdSequence(options.seed)
  );
}

export function resolveGameExecutionContext(
  contextOrNow?: GameExecutionContext | Date
): GameExecutionContext {
  // `typeof` fängt auch Callback-Indizes ab, wenn eine Funktion direkt an `.map()` übergeben wird.
  if (typeof contextOrNow !== 'object' || contextOrNow instanceof Date) {
    return createRealtimeExecutionContext(contextOrNow instanceof Date ? contextOrNow : undefined);
  }
  return contextOrNow;
}
