import { BlurFilter, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { VisibleAsteroid } from '@orions-frontier/shared';
import {
  CHUNK_SIZE,
  ASTEROID_SIZE_RADIUS,
  ASTEROID_DEFAULT_RADIUS,
  UNSCANNED_ASTEROID_RADIUS,
  UNSCANNED_ASTEROID_TINT,
} from './constants.js';
import { resourceColor } from '../mining-utils.js';
import { chunkKey } from './ChunkStreamer.js';
import type { ChunkKey } from './ChunkStreamer.js';

// AsteroidLayer
// Manages one cullable PixiJS Container per loaded chunk. Unscanned asteroids of every
// chunk share one blurred root, so the blur is a single filter pass per frame.

/** Below this zoom asteroids are a few pixels wide and the blur pass buys nothing. */
const BLUR_MIN_ZOOM = 0.25;
/** Sprites reach past their chunk edge by up to the largest drawn radius. */
const CULL_PADDING = 80;

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

  private scannedRoot = new Container();
  private unscannedRoot = new Container();
  private chunkContainers = new Map<ChunkKey, Container[]>();

  // Hit-test data: per-chunk list and flat id→position map
  private chunkAsteroidData = new Map<ChunkKey, AsteroidHit[]>();
  private asteroidById = new Map<string, AsteroidHit>();

  /** Shared by every chunk: unscanned asteroids render as blurred, uniform silhouettes. */
  private unscannedBlur = new BlurFilter({ strength: 2 });

  /** Asteroid textures (index 0–5 → asteroid1.webp–asteroid6.webp) */
  private textures: Texture[] = [];

  constructor() {
    this.unscannedRoot.filters = [this.unscannedBlur];
    this.container.addChild(this.unscannedRoot, this.scannedRoot);
  }

  setTextures(textures: Texture[]) {
    this.textures = textures;
  }

  /** Drops the blur pass while zoomed far out; call each frame. */
  setZoom(zoom: number) {
    const blur = zoom >= BLUR_MIN_ZOOM;
    if (blur !== this.unscannedRoot.filters.length > 0) {
      this.unscannedRoot.filters = blur ? [this.unscannedBlur] : [];
    }
  }

  addChunk(key: ChunkKey, asteroids: VisibleAsteroid[]) {
    this.removeChunk(key); // idempotent

    const [cx = 0, cy = 0] = key.split(':').map(Number);
    const cullArea = new Rectangle(
      cx * CHUNK_SIZE - CULL_PADDING,
      cy * CHUNK_SIZE - CULL_PADDING,
      CHUNK_SIZE + 2 * CULL_PADDING,
      CHUNK_SIZE + 2 * CULL_PADDING
    );
    const [chunkContainer, unscannedContainer] = [new Container(), new Container()];
    for (const part of [chunkContainer, unscannedContainer]) {
      part.label = `chunk-${key}`;
      part.cullable = true;
      part.cullableChildren = false;
      part.cullArea = cullArea;
    }

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

      // Same resource palette as the HUD, so map and panels read alike.
      if (a.primaryResourceKey) sprite.tint = resourceColor(a.primaryResourceKey);

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

    this.chunkContainers.set(key, [chunkContainer, unscannedContainer]);
    this.scannedRoot.addChild(chunkContainer);
    this.unscannedRoot.addChild(unscannedContainer);
  }

  removeChunk(key: ChunkKey) {
    const existing = this.chunkContainers.get(key);
    if (!existing) return;
    // Sprites share the asteroid textures, so destroying children never frees them.
    for (const part of existing) part.destroy({ children: true });
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
