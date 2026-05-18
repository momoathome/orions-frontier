import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { Camera } from './Camera.js';
import { ChunkStreamer } from './ChunkStreamer.js';
import { AsteroidLayer } from './AsteroidLayer.js';
import {
  ZOOM_INITIAL,
  ZOOM_STEP,
  CLICK_MOVE_THRESHOLD,
  GRID_WORLD_SIZE,
  GRID_MIN_PX,
} from './constants.js';

// ============================================================================
// WorldRenderer
// Main orchestrator — owns the PixiJS Application and ties together:
//   Camera (pan/zoom/coordinate math)
//   ChunkStreamer (chunk lifecycle + API fetching)
//   AsteroidLayer (PixiJS rendering per chunk)
//   Background (star field + world-aligned grid)
// ============================================================================

export interface StationInfo {
  x: number;
  y: number;
  name: string;
}

export class WorldRenderer {
  // ── Core systems ──────────────────────────────────────────────────────────
  readonly camera: Camera;
  private streamer: ChunkStreamer;
  private asteroidLayer: AsteroidLayer;

  // ── PixiJS objects ────────────────────────────────────────────────────────
  private app!: Application;
  /** Transformed by the camera — everything in world space lives here */
  private worldContainer!: Container;
  /** Fixed to screen — stars, grid overlay */
  private screenContainer!: Container;
  private gridGraphics!: Graphics;

  // ── Input state ───────────────────────────────────────────────────────────
  private isDragging = false;
  private pointerDownX = 0;
  private pointerDownY = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private activePointerId: number | null = null;

  // ── Selection / hover rings ──────────────────────────────────────────────
  private hoverRingG!: Graphics;
  private selectionRingG!: Graphics;
  private _selectedAsteroidId: string | null = null;
  private _hoveredAsteroidId: string | null = null;

  // ── Station hover ─────────────────────────────────────────────────────────
  private stationInfo: StationInfo | null = null;
  /** Half the station sprite size in world units — used for hover hit-test */
  private readonly stationRadius = 50;
  private _hoveredStation = false;
  private _selectedStation = false;
  private _isHoveringEntity = false;
  private stationOverlay: Container | null = null;

  // ── External callbacks ────────────────────────────────────────────────────
  /** Called when the user clicks an asteroid (provides asteroid id) */
  onAsteroidClick: ((id: string) => void) | null = null;
  /** Called when empty world space is clicked (no asteroid hit) */
  onEmptyClick: ((worldX: number, worldY: number) => void) | null = null;
  /** Called when the user clicks the station */
  onStationClick: (() => void) | null = null;
  /** Called whenever drag state changes (for cursor updates in Vue) */
  onDragStateChange: ((dragging: boolean) => void) | null = null;
  /** Called when hover enters/leaves an asteroid (for cursor updates) */
  onHoverEntityChange: ((isHovering: boolean) => void) | null = null;

  private abortController = new AbortController();

  constructor() {
    this.camera = new Camera(ZOOM_INITIAL);
    this.streamer = new ChunkStreamer();
    this.asteroidLayer = new AsteroidLayer();

    this.streamer.onChunkLoaded = (key, asteroids) => {
      this.asteroidLayer.addChunk(key, asteroids);
    };
    this.streamer.onChunkUnloaded = (key) => {
      this.asteroidLayer.removeChunk(key);
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async mount(
    el: HTMLElement,
    station: StationInfo | null = null,
    scannerStrength = 0
  ): Promise<void> {
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;

    this.camera.resize(w, h);
    if (station) {
      this.camera.x = station.x;
      this.camera.y = station.y;
    }

    this.streamer.scannerStrength = scannerStrength;

    // ── PixiJS Application ──────────────────────────────────────────────────
    this.app = new Application();
    await this.app.init({
      width: w,
      height: h,
      backgroundColor: 0x070b14,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    el.appendChild(this.app.canvas);

    // ── Textures ─────────────────────────────────────────────────────────────
    const asteroidTextures: Texture[] = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((i) => Assets.load(`/assets/map/asteroid${i}.webp`))
    );
    this.asteroidLayer.setTextures(asteroidTextures);
    const stationTexture: Texture = await Assets.load('/assets/map/station.webp');

    // ── Scene graph ─────────────────────────────────────────────────────────
    // Screen-space layer (no camera transform)
    this.screenContainer = new Container();
    this.app.stage.addChild(this.screenContainer);

    // Grid — redrawn each frame in ticker
    this.gridGraphics = new Graphics();
    this.screenContainer.addChild(this.gridGraphics);

    // World-space layer (camera transform applied each frame)
    this.worldContainer = new Container();
    this.app.stage.addChild(this.worldContainer);

    // Asteroid layer lives in world space
    this.worldContainer.addChild(this.asteroidLayer.container);

    // Station marker
    if (station) {
      this._buildStationMarker(station, stationTexture);
    }

    // Hover and selection rings — drawn on top of asteroids in world space
    this.hoverRingG = new Graphics();
    this.worldContainer.addChild(this.hoverRingG);
    this.selectionRingG = new Graphics();
    this.worldContainer.addChild(this.selectionRingG);

    // ── Input & resize ──────────────────────────────────────────────────────
    this._bindInput(el);

    // ── Render loop ─────────────────────────────────────────────────────────
    this.app.ticker.add(() => this._tick());

    // ── Initial chunk load ──────────────────────────────────────────────────
    this.streamer.immediateUpdate(this.camera);
  }

  /** Set the currently selected asteroid (redraws selection ring). Pass null to clear. */
  setSelectedAsteroid(id: string | null) {
    this._selectedAsteroidId = id;
    this._redrawSelectionRing();
  }

  /** Called by WorldRenderer internals when hover changes. */
  private _redrawHoverRing() {
    this.hoverRingG.clear();
    if (!this._hoveredAsteroidId) return;
    const pos = this.asteroidLayer.getAsteroidPosition(this._hoveredAsteroidId);
    if (!pos) return;
    const { x, y, r } = pos;
    this.hoverRingG.circle(x, y, r + 4);
    this.hoverRingG.stroke({ color: 0x00c8ff, alpha: 0.45, width: 1 });
  }

  private _redrawSelectionRing() {
    this.selectionRingG.clear();
    if (!this._selectedAsteroidId) return;
    const pos = this.asteroidLayer.getAsteroidPosition(this._selectedAsteroidId);
    if (!pos) return;
    const { x, y, r } = pos;
    // Inner bright ring
    this.selectionRingG.circle(x, y, r + 4);
    this.selectionRingG.stroke({ color: 0x00ffcc, alpha: 0.9, width: 1.5 });
    // Outer faint glow ring
    this.selectionRingG.circle(x, y, r + 9);
    this.selectionRingG.stroke({ color: 0x00ffcc, alpha: 0.25, width: 1 });
  }

  destroy() {
    this.abortController.abort();
    this.streamer.destroy();
    this.asteroidLayer.clear();
    if (this.app) {
      this.app.destroy({ removeView: true }, { children: true });
    }
  }

  /** Update scanner strength and reload visible chunks */
  setScannerStrength(strength: number) {
    this.streamer.scannerStrength = strength;
    this.asteroidLayer.clear();
    this.streamer.immediateUpdate(this.camera);
  }

  get loadedChunkCount() {
    return this.asteroidLayer.loadedChunkCount;
  }

  // ── Render tick ───────────────────────────────────────────────────────────

  private _tick() {
    // Apply camera transform to the world container
    this.camera.applyToContainer(this.worldContainer);

    // Redraw dynamic screen-space layers
    this._drawGrid();
  }

  // ── Background: world-aligned grid ───────────────────────────────────────

  private _drawGrid() {
    const { camera } = this;
    const g = this.gridGraphics;
    const vpW = camera.viewportWidth;
    const vpH = camera.viewportHeight;
    const gridPx = GRID_WORLD_SIZE * camera.zoom;

    g.clear();

    if (gridPx < GRID_MIN_PX) return; // too dense at this zoom

    // Compute screen offset so grid lines snap to world-origin multiples
    const originSX = (0 - camera.x) * camera.zoom + vpW / 2;
    const originSY = (0 - camera.y) * camera.zoom + vpH / 2;
    const offsetX = ((originSX % gridPx) + gridPx) % gridPx;
    const offsetY = ((originSY % gridPx) + gridPx) % gridPx;

    g.setStrokeStyle({ color: 0x00a0dc, alpha: 0.04, width: 1 });

    for (let x = offsetX; x <= vpW; x += gridPx) {
      g.moveTo(x, 0);
      g.lineTo(x, vpH);
    }
    for (let y = offsetY; y <= vpH; y += gridPx) {
      g.moveTo(0, y);
      g.lineTo(vpW, y);
    }
    g.stroke();
  }

  // ── Station marker ────────────────────────────────────────────────────────

  private _buildStationMarker(station: StationInfo, stationTexture: Texture) {
    const { x, y, name } = station;
    this.stationInfo = station;

    // Sprite — square to preserve 128×128 source aspect ratio
    const size = this.stationRadius * 2; // 100 world units
    const sprite = new Sprite(stationTexture);
    sprite.anchor.set(0.5, 0.5);
    sprite.position.set(x, y);
    sprite.width = size;
    sprite.height = size;
    this.worldContainer.addChild(sprite);

    // ── Station overlay (brackets + label — visible on hover/active) ───────
    const overlay = new Container();
    overlay.visible = false;
    this.stationOverlay = overlay;

    // Corner brackets
    const bracketG = new Graphics();
    const half = this.stationRadius;
    const bs = 12;
    this._drawBracket(bracketG, x - half, y - half, bs, 1, 1);
    this._drawBracket(bracketG, x + half, y - half, bs, -1, 1);
    this._drawBracket(bracketG, x - half, y + half, bs, 1, -1);
    this._drawBracket(bracketG, x + half, y + half, bs, -1, -1);
    overlay.addChild(bracketG);

    // Name label
    const label = new Text({
      text: `[ ${name.toUpperCase()} ]`,
      style: { fontFamily: 'monospace', fontSize: 11, fill: 0x00c8ff, align: 'center' },
    });
    label.anchor.set(0.5, 1);
    label.position.set(x, y - half - 8);
    overlay.addChild(label);

    this.worldContainer.addChild(overlay);
  }

  private _drawBracket(
    g: Graphics,
    cornerX: number,
    cornerY: number,
    size: number,
    dirX: 1 | -1,
    dirY: 1 | -1
  ) {
    g.moveTo(cornerX + dirX * size, cornerY);
    g.lineTo(cornerX, cornerY);
    g.lineTo(cornerX, cornerY + dirY * size);
    g.stroke({ color: 0x00e6c8, alpha: 0.85, width: 1.5 });
  }

  // ── Input handling ────────────────────────────────────────────────────────

  private _bindInput(el: HTMLElement) {
    const { signal } = this.abortController;

    el.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const factor = e.deltaY < 0 ? 1 + ZOOM_STEP : 1 / (1 + ZOOM_STEP);
        this.camera.zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
        this.streamer.scheduleUpdate(this.camera);
      },
      { passive: false, signal }
    );

    el.addEventListener(
      'pointerdown',
      (e: PointerEvent) => {
        if (e.button !== 0) return;
        this.isDragging = true;
        this.activePointerId = e.pointerId;
        this.pointerDownX = e.clientX;
        this.pointerDownY = e.clientY;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        el.setPointerCapture(e.pointerId);
        this.onDragStateChange?.(true);
      },
      { signal }
    );

    el.addEventListener(
      'pointermove',
      (e: PointerEvent) => {
        if (this.isDragging && e.pointerId === this.activePointerId) {
          const dx = e.clientX - this.lastPointerX;
          const dy = e.clientY - this.lastPointerY;
          this.camera.pan(dx, dy);
          this.lastPointerX = e.clientX;
          this.lastPointerY = e.clientY;
          this.streamer.scheduleUpdate(this.camera);
        } else if (!this.isDragging) {
          // Hover hit-test when not panning
          const rect = el.getBoundingClientRect();
          const world = this.camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
          const tolerance = Math.max(15, 20 / this.camera.zoom);

          // Asteroid hover
          const hit = this.asteroidLayer.hitTest(world.x, world.y, tolerance);
          const newId = hit?.id ?? null;
          if (newId !== this._hoveredAsteroidId) {
            this._hoveredAsteroidId = newId;
            this._redrawHoverRing();
          }

          // Station hover
          const newHoveredStation = this.stationInfo
            ? Math.hypot(world.x - this.stationInfo.x, world.y - this.stationInfo.y) <=
              this.stationRadius + 5
            : false;
          if (newHoveredStation !== this._hoveredStation) {
            this._hoveredStation = newHoveredStation;
            if (this.stationOverlay) {
              this.stationOverlay.visible = newHoveredStation || this._selectedStation;
            }
          }

          // Unified cursor callback
          const isHovering = newId !== null || newHoveredStation;
          if (isHovering !== this._isHoveringEntity) {
            this._isHoveringEntity = isHovering;
            this.onHoverEntityChange?.(isHovering);
          }
        }
      },
      { signal }
    );

    const onPointerEnd = (e: PointerEvent) => {
      if (!this.isDragging || e.pointerId !== this.activePointerId) return;
      this.isDragging = false;
      this.activePointerId = null;
      this.onDragStateChange?.(false);

      // Emit a click if the pointer barely moved (not a pan)
      const moved = Math.hypot(e.clientX - this.pointerDownX, e.clientY - this.pointerDownY);
      if (moved < CLICK_MOVE_THRESHOLD) {
        const rect = el.getBoundingClientRect();
        const world = this.camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        const tolerance = Math.max(15, 20 / this.camera.zoom);
        const hit = this.asteroidLayer.hitTest(world.x, world.y, tolerance);
        const stationHit = this.stationInfo
          ? Math.hypot(world.x - this.stationInfo.x, world.y - this.stationInfo.y) <=
            this.stationRadius + 5
          : false;
        if (hit) {
          this._selectedStation = false;
          if (this.stationOverlay) this.stationOverlay.visible = this._hoveredStation;
          this.onAsteroidClick?.(hit.id);
        } else if (stationHit) {
          this._selectedStation = true;
          if (this.stationOverlay) this.stationOverlay.visible = true;
          this.onStationClick?.();
        } else {
          this._selectedStation = false;
          if (this.stationOverlay) this.stationOverlay.visible = this._hoveredStation;
          this.onEmptyClick?.(world.x, world.y);
        }
      }
    };

    el.addEventListener('pointerup', onPointerEnd, { signal });
    el.addEventListener('pointercancel', onPointerEnd, { signal });

    window.addEventListener(
      'resize',
      () => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        this.camera.resize(w, h);
        this.app.renderer.resize(w, h);
        this.streamer.scheduleUpdate(this.camera);
      },
      { signal }
    );
  }
}
