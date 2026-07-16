import { Graphics } from 'pixi.js';

// ============================================================================
// RouteLayer
// Draws animated dashed connection lines in world space.
// Used for:
//   - Mining assignments (station → asteroid)
//   - Transporter routes (station → asteroid, later)
//
// Call setRoutes() to update, redraw(phase) every tick for animation.
// ============================================================================

export interface RouteEntry {
  /** Unique key — used for deduplication */
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** PixiJS hex color, e.g. 0x00c8ff */
  color: number;
  /** Line alpha 0–1, defaults to 0.3 */
  alpha?: number;
  /** Line width in world units, defaults to 1 */
  width?: number;
  /** Dash length in world units, defaults to 14 */
  dashLen?: number;
  /** Gap length in world units, defaults to 9 */
  gapLen?: number;
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Draws a dashed line along (x1,y1)→(x2,y2).
 * `phase` is the offset into the dash cycle (world units) — increment each
 * frame to animate the dashes moving toward the destination.
 */
function drawDashedLine(
  g: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dashLen: number,
  gapLen: number,
  phase: number
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const totalDist = Math.hypot(dx, dy);
  if (totalDist < 1) return;

  const ux = dx / totalDist;
  const uy = dy / totalDist;
  const period = dashLen + gapLen;

  // Normalize phase and find start position within the current cycle
  let pos = ((-phase % period) + period) % period;
  // If we start mid-gap, back up so the first segment is partial-dash or partial-gap
  if (pos >= dashLen) pos -= period; // may be negative — first seg will be partial

  while (pos < totalDist) {
    const segStart = Math.max(pos, 0);
    const segEnd = Math.min(pos + dashLen, totalDist);
    if (segStart < segEnd) {
      g.moveTo(x1 + ux * segStart, y1 + uy * segStart);
      g.lineTo(x1 + ux * segEnd, y1 + uy * segEnd);
    }
    pos += period;
  }
}

// ── RouteLayer ────────────────────────────────────────────────────────────────

export class RouteLayer {
  /** Add this Graphics to the world container (below asteroids). */
  readonly graphics = new Graphics();

  private routes: RouteEntry[] = [];

  setRoutes(routes: RouteEntry[]): void {
    this.routes = routes;
  }

  clear(): void {
    this.routes = [];
    this.graphics.clear();
  }

  /**
   * Redraws all routes with the given phase offset.
   * phase increases each frame → dashes animate toward destination.
   */
  redraw(phase: number): void {
    this.graphics.clear();
    if (this.routes.length === 0) return;

    for (const route of this.routes) {
      const alpha = route.alpha ?? 0.3;
      const width = route.width ?? 1;
      const dashLen = route.dashLen ?? 14;
      const gapLen = route.gapLen ?? 9;

      this.graphics.setStrokeStyle({ color: route.color, alpha, width });
      drawDashedLine(
        this.graphics,
        route.fromX,
        route.fromY,
        route.toX,
        route.toY,
        dashLen,
        gapLen,
        phase
      );
      this.graphics.stroke();
    }
  }
}
