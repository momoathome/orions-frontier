import type { DebrisField, VisibleAsteroid, VisibleStation } from '@orions-frontier/shared';
import {
  CHUNK_LOAD_MARGIN,
  CHUNK_UNLOAD_MARGIN,
  CHUNK_DEBOUNCE_MS,
  MAX_CHUNK_AXIS,
} from './constants.js';
import type { Camera, VisibleChunkRange } from './Camera.js';
import { apiClient } from '../../../shared/api/api-client.js';

// ChunkStreamer
// Manages chunk lifecycle: calculates which chunks should be loaded,
// fetches them from the API, and notifies when chunks should be removed.

export type ChunkKey = string;

export interface WorldChunk {
  asteroids: VisibleAsteroid[];
  stations: VisibleStation[];
  debris: DebrisField[];
}

export function chunkKey(cx: number, cy: number): ChunkKey {
  return `${cx}:${cy}`;
}

interface SubRange {
  minCX: number;
  maxCX: number;
  minCY: number;
  maxCY: number;
}

export class ChunkStreamer {
  /** All currently loaded chunk data */
  private loadedChunks = new Map<ChunkKey, WorldChunk>();
  /**
   * Chunks whose fetch is in flight, with the newest request for each. Only that request may
   * write the chunk, so an older overlapping or other-visibility-mode response is dropped.
   */
  private pendingChunks = new Map<ChunkKey, number>();
  private lastRequest = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private scannerBypass = false;

  onChunkLoaded: ((key: ChunkKey, chunk: WorldChunk) => void) | null = null;
  onChunkUnloaded: ((key: ChunkKey) => void) | null = null;

  /** Debounced update — call on every camera move */
  scheduleUpdate(camera: Camera) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this._update(camera);
    }, CHUNK_DEBOUNCE_MS);
  }

  /** Immediate update — call on first mount */
  immediateUpdate(camera: Camera) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this._update(camera);
  }

  /** Fetch the visible chunks again; loaded chunks stay drawn until their replacement arrives. */
  refresh(camera: Camera) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this._update(camera, true);
  }

  setScannerBypass(enabled: boolean, camera: Camera) {
    if (this.scannerBypass === enabled) return;
    this.scannerBypass = enabled;
    this.pendingChunks.clear();
    // Drop everything so no chunk keeps data from the other visibility mode.
    for (const key of this.loadedChunks.keys()) this.onChunkUnloaded?.(key);
    this.loadedChunks.clear();
    this.immediateUpdate(camera);
  }

  destroy() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    // Requests still in flight must not draw into destroyed layers.
    this.onChunkLoaded = null;
    this.onChunkUnloaded = null;
  }

  private _update(camera: Camera, reloadAll = false) {
    const loadRange = camera.getVisibleChunkRange(CHUNK_LOAD_MARGIN);
    const keepRange = camera.getVisibleChunkRange(CHUNK_LOAD_MARGIN + CHUNK_UNLOAD_MARGIN);

    // Unload chunks that have moved beyond the keep margin
    for (const key of this.loadedChunks.keys()) {
      const [cx = 0, cy = 0] = key.split(':').map(Number);
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
      for (const request of reloadAll ? [sub] : this._missingRects(sub)) {
        void this._fetchChunks(request, reloadAll);
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

  /**
   * The chunks still missing in `sub` as row strips; rows with the same span merge. A pan
   * fetches only its new edge, and a diagonal pan's L-shape becomes two strips, not one box.
   */
  private _missingRects(sub: SubRange): SubRange[] {
    const rects: SubRange[] = [];
    for (let cy = sub.minCY; cy <= sub.maxCY; cy++) {
      let minCX = Infinity;
      let maxCX = -Infinity;
      for (let cx = sub.minCX; cx <= sub.maxCX; cx++) {
        const key = chunkKey(cx, cy);
        if (this.loadedChunks.has(key) || this.pendingChunks.has(key)) continue;
        minCX = Math.min(minCX, cx);
        maxCX = Math.max(maxCX, cx);
      }
      if (minCX > maxCX) continue;
      const last = rects.at(-1);
      if (last?.maxCY === cy - 1 && last.minCX === minCX && last.maxCX === maxCX) last.maxCY = cy;
      else rects.push({ minCX, maxCX, minCY: cy, maxCY: cy });
    }
    return rects;
  }

  private async _fetchChunks(sub: SubRange, replace = false) {
    const request = ++this.lastRequest;
    const ownsChunk = (key: ChunkKey) => this.pendingChunks.get(key) === request;
    // Mark all chunks in this sub-range as pending
    for (let cx = sub.minCX; cx <= sub.maxCX; cx++) {
      for (let cy = sub.minCY; cy <= sub.maxCY; cy++) {
        this.pendingChunks.set(chunkKey(cx, cy), request);
      }
    }

    try {
      const response = await apiClient.get<WorldChunk>('/world/chunks', {
        params: {
          minChunkX: sub.minCX,
          maxChunkX: sub.maxCX,
          minChunkY: sub.minCY,
          maxChunkY: sub.maxCY,
          scannerBypass: this.scannerBypass,
        },
      });

      const { asteroids, stations, debris } = response;

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
        if (!ownsChunk(key)) continue;
        this.pendingChunks.delete(key);
        // A strip can include a chunk loaded in the meantime; rebuilding it only costs GC.
        if (!replace && this.loadedChunks.has(key)) continue;
        this.loadedChunks.set(key, chunk);
        this.onChunkLoaded?.(key, chunk);
      }
    } catch {
      // Clear pending so the chunks can be retried on the next camera update
      for (let cx = sub.minCX; cx <= sub.maxCX; cx++) {
        for (let cy = sub.minCY; cy <= sub.maxCY; cy++) {
          if (ownsChunk(chunkKey(cx, cy))) this.pendingChunks.delete(chunkKey(cx, cy));
        }
      }
    }
  }
}
