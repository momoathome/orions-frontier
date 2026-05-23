// ============================================================================
// Renderer constants
// ============================================================================

/** Must match WORLD_CONFIG.CHUNK_SIZE in apps/api/src/lib/world-config.ts */
export const CHUNK_SIZE = 1000;

export const ZOOM_MIN = 0.06;
export const ZOOM_MAX = 4.0;
/** Starting zoom: gives a good overview of the immediate world */
export const ZOOM_INITIAL = 0.5;
/** Zoom multiplier per mouse wheel tick */
export const ZOOM_STEP = 0.12;

/** Extra chunks to load beyond the visible viewport */
export const CHUNK_LOAD_MARGIN = 1;
/** Additional chunks to keep before triggering unload */
export const CHUNK_UNLOAD_MARGIN = 3;
/** Delay (ms) before chunk requests fire after camera movement stops */
export const CHUNK_DEBOUNCE_MS = 150;
/** Max chunk range per axis the API accepts */
export const MAX_CHUNK_AXIS = 15;

/** Minimum pointer movement (px) to be treated as a pan, not a click */
export const CLICK_MOVE_THRESHOLD = 10;

/** Asteroid visual radius per size category (world units) */
export const ASTEROID_SIZE_RADIUS: Record<string, number> = {
  small: 14,
  medium: 24,
  large: 36,
  massive: 56,
};
/** Fallback radius for unknown size */
export const ASTEROID_DEFAULT_RADIUS = 8;

/** Grid line spacing in world units (for the background grid) */
export const GRID_WORLD_SIZE = 500;
/** Minimum grid spacing in screen pixels before the grid is hidden */
export const GRID_MIN_PX = 16;

// ── Resource visual identity ──────────────────────────────────────────────────
//
// Tint color applied to asteroid sprites per primary resource.
// Used by AsteroidLayer to give each resource type a distinct visual identity.

export const RESOURCE_TINT: Record<string, number> = {
  carbon:        0x8B4010,  // rust / dark orange-brown
  titanium:      0xB8C8D8,  // metallic silver-blue
  hydrogenium:   0x6AB4E8,  // pale ice blue
  kyber_crystal: 0x4B6EFB,  // glowing deep blue
  astatine:      0x9B30FF,  // purple / dark energy
};


