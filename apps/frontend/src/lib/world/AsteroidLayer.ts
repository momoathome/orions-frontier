import { Container, Graphics } from 'pixi.js';
import type { VisibleAsteroid } from '@orions-frontier/shared';
import {
  CHUNK_SIZE,
  RESOURCE_COLORS,
  ASTEROID_SIZE_RADIUS,
  ASTEROID_DEFAULT_RADIUS,
} from './constants.js';
import { chunkKey } from './ChunkStreamer.js';
import type { ChunkKey } from './ChunkStreamer.js';

// ============================================================================
// AsteroidLayer
// Manages one PixiJS Container per loaded chunk.
// Asteroids in a chunk are drawn onto a single Graphics object
// (one draw call per chunk) for high throughput with thousands of asteroids.
// ============================================================================

export interface AsteroidHit {
  id: string;
  x: number;
  y: number;
  r: number;
  primaryResourceKey: string;
  size: string;
}

export class AsteroidLayer {
  /** Root container — add this to the world container */
  readonly container = new Container();

  private chunkContainers = new Map<ChunkKey, Container>();

  // Hit-test data: per-chunk list and flat id→position map
  private chunkAsteroidData = new Map<ChunkKey, AsteroidHit[]>();
  private asteroidById = new Map<string, AsteroidHit>();

  // ── Public interface ────────────────────────────────────────────────────

  addChunk(key: ChunkKey, asteroids: VisibleAsteroid[]) {
    this.removeChunk(key); // idempotent

    const chunkContainer = new Container();
    chunkContainer.label = `chunk-${key}`;

    if (asteroids.length > 0) {
      // Glow pass — all asteroids, drawn first (back layer)
      const glowG = new Graphics();
      for (const a of asteroids) {
        const color = RESOURCE_COLORS[a.primaryResourceKey] ?? 0x888888;
        const r = ASTEROID_SIZE_RADIUS[a.size] ?? ASTEROID_DEFAULT_RADIUS;
        glowG.circle(a.x, a.y, r + 3);
        glowG.fill({ color, alpha: 0.14 });
      }
      chunkContainer.addChild(glowG);

      // Body pass — all asteroids, drawn on top
      const bodyG = new Graphics();
      for (const a of asteroids) {
        const color = RESOURCE_COLORS[a.primaryResourceKey] ?? 0x888888;
        const r = ASTEROID_SIZE_RADIUS[a.size] ?? ASTEROID_DEFAULT_RADIUS;
        bodyG.circle(a.x, a.y, r);
        bodyG.fill({ color, alpha: 0.88 });
      }
      chunkContainer.addChild(bodyG);
    }

    // Store positions for hit-testing
    const hitData: AsteroidHit[] = asteroids.map((a) => ({
      id: a.id,
      x: a.x,
      y: a.y,
      r: ASTEROID_SIZE_RADIUS[a.size] ?? ASTEROID_DEFAULT_RADIUS,
      primaryResourceKey: a.primaryResourceKey,
      size: a.size,
    }));
    this.chunkAsteroidData.set(key, hitData);
    for (const h of hitData) {
      this.asteroidById.set(h.id, h);
    }

    this.chunkContainers.set(key, chunkContainer);
    this.container.addChild(chunkContainer);
  }

  removeChunk(key: ChunkKey) {
    const existing = this.chunkContainers.get(key);
    if (!existing) return;
    this.container.removeChild(existing);
    existing.destroy({ children: true });
    this.chunkContainers.delete(key);

    // Clean up hit-test data for this chunk
    const hitData = this.chunkAsteroidData.get(key) ?? [];
    for (const h of hitData) {
      this.asteroidById.delete(h.id);
    }
    this.chunkAsteroidData.delete(key);
  }

  clear() {
    for (const key of [...this.chunkContainers.keys()]) {
      this.removeChunk(key);
    }
    this.asteroidById.clear();
    this.chunkAsteroidData.clear();
  }

  get loadedChunkCount() {
    return this.chunkContainers.size;
  }

  // ── Hit testing ────────────────────────────────────────────────────────────

  /**
   * Returns the asteroid at world position (wx, wy) within the given tolerance,
   * or null if none. Only checks the chunk that contains the point.
   * `tolerance` is the minimum clickable radius in world units (ensures
   * small asteroids are still clickable at low zoom).
   */
  hitTest(wx: number, wy: number, tolerance: number): AsteroidHit | null {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cy = Math.floor(wy / CHUNK_SIZE);
    const key = chunkKey(cx, cy);
    const candidates = this.chunkAsteroidData.get(key) ?? [];

    let best: AsteroidHit | null = null;
    let bestDist = Infinity;

    for (const a of candidates) {
      const dist = Math.hypot(wx - a.x, wy - a.y);
      const threshold = Math.max(a.r, tolerance);
      if (dist <= threshold && dist < bestDist) {
        bestDist = dist;
        best = a;
      }
    }

    return best;
  }

  /** Look up a loaded asteroid's position data by id. */
  getAsteroidPosition(id: string): AsteroidHit | undefined {
    return this.asteroidById.get(id);
  }
}
