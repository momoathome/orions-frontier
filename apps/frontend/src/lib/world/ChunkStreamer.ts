import type { DebrisField, VisibleAsteroid, VisibleStation } from '@orions-frontier/shared';
import {
  CHUNK_LOAD_MARGIN,
  CHUNK_UNLOAD_MARGIN,
  CHUNK_DEBOUNCE_MS,
  MAX_CHUNK_AXIS,
} from './constants.js';
import type { Camera, VisibleChunkRange } from './Camera.js';
import { apiClient } from '../api-client.js';

// ============================================================================
// ChunkStreamer
// Manages chunk lifecycle: calculates which chunks should be loaded,
// fetches them from the API, and notifies when chunks should be removed.
// ============================================================================

export type ChunkKey = string;

export interface WorldChunk {
  asteroids: VisibleAsteroid[];
  stations: VisibleStation[];
  debris: DebrisField[];
}

export function chunkKey(cx: number, cy: number): ChunkKey {
  return `${cx}:${cy}`;
}

type SubRange = {
  minCX: number;
  maxCX: number;
  minCY: number;
  maxCY: number;
};

export class ChunkStreamer {
  /** All currently loaded chunk data */
  private loadedChunks = new Map<ChunkKey, WorldChunk>();
  /** Chunks whose fetch is in-flight */
  private pendingChunks = new Set<ChunkKey>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  onChunkLoaded: ((key: ChunkKey, chunk: WorldChunk) => void) | null = null;
  onChunkUnloaded: ((key: ChunkKey) => void) | null = null;

  // ── Public interface ────────────────────────────────────────────────────

  getLoaded(): ReadonlyMap<ChunkKey, WorldChunk> {
    return this.loadedChunks;
  }

  /** Debounced update — call on every camera move */
  scheduleUpdate(camera: Camera) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this._update(camera), CHUNK_DEBOUNCE_MS);
  }

  /** Immediate update — call on first mount */
  immediateUpdate(camera: Camera) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this._update(camera);
  }

  /** Discard cached world data and fetch the currently visible chunks again. */
  refresh(camera: Camera) {
    for (const key of this.loadedChunks.keys()) this.onChunkUnloaded?.(key);
    this.loadedChunks.clear();
    this.immediateUpdate(camera);
  }

  destroy() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private _update(camera: Camera) {
    const loadRange = camera.getVisibleChunkRange(CHUNK_LOAD_MARGIN);
    const keepRange = camera.getVisibleChunkRange(CHUNK_LOAD_MARGIN + CHUNK_UNLOAD_MARGIN);

    // Unload chunks that have moved beyond the keep margin
    for (const key of this.loadedChunks.keys()) {
      const [cx, cy] = key.split(':').map(Number) as [number, number];
      if (
        cx < keepRange.minChunkX ||
        cx > keepRange.maxChunkX ||
        cy < keepRange.minChunkY ||
        cy > keepRange.maxChunkY
      ) {
        this.loadedChunks.delete(key);
        this.onChunkUnloaded?.(key);
      }
    }

    // Split the load range into sub-requests that fit within the API limit,
    // then fetch only those that contain un-loaded chunks.
    for (const sub of this._splitRange(loadRange)) {
      if (this._hasNewChunks(sub)) {
        this._fetchChunks(sub);
      }
    }
  }

  /** Split a potentially large range into API-compatible sub-ranges */
  private _splitRange(range: VisibleChunkRange): SubRange[] {
    const result: SubRange[] = [];
    for (let x = range.minChunkX; x <= range.maxChunkX; x += MAX_CHUNK_AXIS + 1) {
      for (let y = range.minChunkY; y <= range.maxChunkY; y += MAX_CHUNK_AXIS + 1) {
        result.push({
          minCX: x,
          maxCX: Math.min(x + MAX_CHUNK_AXIS, range.maxChunkX),
          minCY: y,
          maxCY: Math.min(y + MAX_CHUNK_AXIS, range.maxChunkY),
        });
      }
    }
    return result;
  }

  private _hasNewChunks(sub: SubRange): boolean {
    for (let cx = sub.minCX; cx <= sub.maxCX; cx++) {
      for (let cy = sub.minCY; cy <= sub.maxCY; cy++) {
        const key = chunkKey(cx, cy);
        if (!this.loadedChunks.has(key) && !this.pendingChunks.has(key)) return true;
      }
    }
    return false;
  }

  private async _fetchChunks(sub: SubRange) {
    // Mark all chunks in this sub-range as pending
    for (let cx = sub.minCX; cx <= sub.maxCX; cx++) {
      for (let cy = sub.minCY; cy <= sub.maxCY; cy++) {
        this.pendingChunks.add(chunkKey(cx, cy));
      }
    }

    try {
      const response = await apiClient.get<{ success: true; data: WorldChunk }>('/world/chunks', {
        params: {
          minChunkX: sub.minCX,
          maxChunkX: sub.maxCX,
          minChunkY: sub.minCY,
          maxChunkY: sub.maxCY,
        },
      });

      const { asteroids, stations, debris } = response.data;

      // Build a per-chunk map covering every chunk in the sub-range
      // (empty chunks are stored too, so they don't get re-requested)
      const byChunk = new Map<ChunkKey, WorldChunk>();
      for (let cx = sub.minCX; cx <= sub.maxCX; cx++) {
        for (let cy = sub.minCY; cy <= sub.maxCY; cy++) {
          byChunk.set(chunkKey(cx, cy), { asteroids: [], stations: [], debris: [] });
        }
      }
      for (const a of asteroids) {
        const key = chunkKey(a.chunkX, a.chunkY);
        byChunk.get(key)?.asteroids.push(a);
      }
      for (const station of stations) {
        const key = chunkKey(station.chunkX, station.chunkY);
        byChunk.get(key)?.stations.push(station);
      }
      for (const field of debris) {
        const key = chunkKey(field.chunkX, field.chunkY);
        byChunk.get(key)?.debris.push(field);
      }

      for (const [key, chunk] of byChunk) {
        this.pendingChunks.delete(key);
        this.loadedChunks.set(key, chunk);
        this.onChunkLoaded?.(key, chunk);
      }
    } catch {
      // Clear pending so the chunks can be retried on the next camera update
      for (let cx = sub.minCX; cx <= sub.maxCX; cx++) {
        for (let cy = sub.minCY; cy <= sub.maxCY; cy++) {
          this.pendingChunks.delete(chunkKey(cx, cy));
        }
      }
    }
  }
}
