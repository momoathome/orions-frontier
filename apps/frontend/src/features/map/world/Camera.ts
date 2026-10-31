import { CHUNK_SIZE } from './constants.js';
import { ZOOM_MIN, ZOOM_MAX } from './constants.js';
import type { Container } from 'pixi.js';

// Camera
// Manages the viewport position and zoom level.
// All coordinate conversions flow through here.

export interface VisibleChunkRange {
  minChunkX: number;
  maxChunkX: number;
  minChunkY: number;
  maxChunkY: number;
}

export class Camera {
  /** World-space center of the viewport */
  x = 0;
  y = 0;
  /** Pixels per world unit */
  zoom: number;

  private vpW = 1;
  private vpH = 1;

  constructor(initialZoom: number) {
    this.zoom = initialZoom;
  }

  resize(w: number, h: number) {
    this.vpW = w;
    this.vpH = h;
  }

  get viewportWidth() {
    return this.vpW;
  }
  get viewportHeight() {
    return this.vpH;
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.x) * this.zoom + this.vpW / 2,
      y: (wy - this.y) * this.zoom + this.vpH / 2,
    };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.vpW / 2) / this.zoom + this.x,
      y: (sy - this.vpH / 2) / this.zoom + this.y,
    };
  }

  /** Pan by a screen-space delta */
  pan(dsx: number, dsy: number) {
    this.x -= dsx / this.zoom;
    this.y -= dsy / this.zoom;
  }

  /**
   * Zoom by `factor`, keeping the world point under `(sx, sy)` stable.
   * sx/sy are in canvas-local coordinates (not page coordinates).
   */
  zoomAt(factor: number, sx: number, sy: number) {
    const world = this.screenToWorld(sx, sy);
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * factor));
    this.x = world.x - (sx - this.vpW / 2) / this.zoom;
    this.y = world.y - (sy - this.vpH / 2) / this.zoom;
  }

  /** World-space AABB of the current viewport, optionally expanded by `margin` world units */
  getVisibleBounds(margin = 0) {
    const hw = this.vpW / 2 / this.zoom + margin;
    const hh = this.vpH / 2 / this.zoom + margin;
    return {
      left: this.x - hw,
      right: this.x + hw,
      top: this.y - hh,
      bottom: this.y + hh,
    };
  }

  /** Chunk coordinate range visible from the current camera position */
  getVisibleChunkRange(extraChunks = 0): VisibleChunkRange {
    const margin = extraChunks * CHUNK_SIZE;
    const b = this.getVisibleBounds(margin);
    return {
      minChunkX: Math.floor(b.left / CHUNK_SIZE),
      maxChunkX: Math.floor(b.right / CHUNK_SIZE),
      minChunkY: Math.floor(b.top / CHUNK_SIZE),
      maxChunkY: Math.floor(b.bottom / CHUNK_SIZE),
    };
  }

  /**
   * Apply the camera transform to a PixiJS container.
   * Any child placed at world position (wx, wy) will render at the correct screen position.
   */
  applyToContainer(container: Container) {
    container.position.set(this.vpW / 2 - this.x * this.zoom, this.vpH / 2 - this.y * this.zoom);
    container.scale.set(this.zoom);
  }
}
