import { BlurFilter, Container, Sprite, Texture } from 'pixi.js';
import type { VisibleAsteroid } from '@orions-frontier/shared';
import {
  CHUNK_SIZE,
  ASTEROID_SIZE_RADIUS,
  ASTEROID_DEFAULT_RADIUS,
  RESOURCE_TINT,
  UNSCANNED_ASTEROID_RADIUS,
  UNSCANNED_ASTEROID_TINT,
} from './constants.js';
import { chunkKey } from './ChunkStreamer.js';
import type { ChunkKey } from './ChunkStreamer.js';

// AsteroidLayer
// Manages one PixiJS Container per loaded chunk.
// Asteroids in a chunk are drawn onto a single Graphics object
// (one draw call per chunk) for high throughput with thousands of asteroids.

export interface AsteroidHit {
  id: string;
  x: number;
  y: number;
  r: number;
}

const radiusFor = (a: VisibleAsteroid): number =>
  a.size ? (ASTEROID_SIZE_RADIUS[a.size] ?? ASTEROID_DEFAULT_RADIUS) : UNSCANNED_ASTEROID_RADIUS;

export class AsteroidLayer {
  /** Root container — add this to the world container */
  readonly container = new Container();

  private chunkContainers = new Map<ChunkKey, Container>();

  // Hit-test data: per-chunk list and flat id→position map
  private chunkAsteroidData = new Map<ChunkKey, AsteroidHit[]>();
  private asteroidById = new Map<string, AsteroidHit>();

  /** Shared by every chunk: unscanned asteroids render as blurred, uniform silhouettes. */
  private unscannedBlur = new BlurFilter({ strength: 2 });

  /** Asteroid textures (index 0–5 → asteroid1.webp–asteroid6.webp) */
  private textures: Texture[] = [];

  setTextures(textures: Texture[]) {
    this.textures = textures;
  }

  addChunk(key: ChunkKey, asteroids: VisibleAsteroid[]) {
    this.removeChunk(key); // idempotent

    const chunkContainer = new Container();
    chunkContainer.label = `chunk-${key}`;

    const unscannedContainer = new Container();
    unscannedContainer.filters = [this.unscannedBlur];
    chunkContainer.addChild(unscannedContainer);

    for (const a of asteroids) {
      const sprite = new Sprite(this._textureFor(a.id));
      sprite.anchor.set(0.5, 0.5);
      sprite.position.set(a.x, a.y);

      if (!a.scanned) {
        const size = UNSCANNED_ASTEROID_RADIUS * 2.4;
        sprite.width = size;
        sprite.height = size;
        sprite.alpha = 0.7;
        sprite.tint = UNSCANNED_ASTEROID_TINT;
        unscannedContainer.addChild(sprite);
        continue;
      }

      const r = radiusFor(a);
      const remaining = a.remainingFraction ?? 1;
      // diameter = 2 * r, with a slight visual margin; mined-out asteroids shrink and fade
      const size = r * 2.4 * (0.45 + 0.55 * remaining);
      sprite.width = size;
      sprite.height = size;
      sprite.alpha = 0.55 + 0.45 * remaining;

      // Resource-based tint for visual identity
      const tint = a.primaryResourceKey ? RESOURCE_TINT[a.primaryResourceKey] : undefined;
      if (tint !== undefined) sprite.tint = tint;

      chunkContainer.addChild(sprite);
    }

    // Store positions for hit-testing
    const hitData: AsteroidHit[] = asteroids.map((a) => ({
      id: a.id,
      x: a.x,
      y: a.y,
      r: radiusFor(a),
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

  /** Deterministically picks one of the 6 asteroid textures from an asteroid id. */
  private _textureFor(id: string): Texture {
    if (this.textures.length === 0) return Texture.WHITE;
    // Use the last 4 hex chars of the UUID for a uniform distribution
    const n = parseInt(id.replace(/-/g, '').slice(-4), 16);
    return this.textures[n % this.textures.length] ?? Texture.WHITE;
  }
}
