import { CHUNK_SIZE } from '@orions-frontier/shared';

// ============================================================================
// Renderer constants
// ============================================================================

export { CHUNK_SIZE };

export const ZOOM_MIN = 0.06;
export const ZOOM_MAX = 4.0;
/** Starting zoom: gives a good overview of the immediate world */
export const ZOOM_INITIAL = 0.14;
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
  small: 8,
  medium: 12,
  large: 24,
  massive: 36,
};
/** Fallback radius for unknown size */
export const ASTEROID_DEFAULT_RADIUS = 8;

/** Grid line spacing in world units (for the background grid) */
export const GRID_WORLD_SIZE = 500;
/** Minimum grid spacing in screen pixels before the grid is hidden */
export const GRID_MIN_PX = 16;
