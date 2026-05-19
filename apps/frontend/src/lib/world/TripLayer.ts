import { Container, Graphics } from 'pixi.js';

// ============================================================================
// TripLayer
// Renders in-flight spacecraft as animated dots moving along their trip path.
// Position is interpolated client-side from departedAt/arrivesAt timestamps —
// no polling needed. The layer redraws each ticker frame.
//
// Add TripLayer.container to the worldContainer so it moves with the camera.
// Call redraw() each frame and setTrips() when trip data changes.
// ============================================================================

export interface ActiveTrip {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  departedAt: number; // ms timestamp
  arrivesAt: number;  // ms timestamp
  purpose: 'mine' | 'transport' | 'recall' | 'return' | 'combat';
  groupSize: number;
}

/** Color per purpose */
const PURPOSE_COLOR: Record<ActiveTrip['purpose'], number> = {
  mine: 0x44aaff, // blue
  transport: 0x44ff88, // green
  recall: 0xffaa22, // orange
  return: 0x44aaff, // blue (same as mine, but could be different if desired)
  combat: 0xff4444, // red
};

export class TripLayer {
  /** Add this to the world container */
  readonly container = new Container();

  private graphics = new Graphics();
  private trips: ActiveTrip[] = [];

  constructor() {
    this.container.addChild(this.graphics);
  }

  setTrips(trips: ActiveTrip[]) {
    this.trips = trips;
  }

  /**
   * Redraws all in-flight ship markers at their interpolated positions.
   * Call this every frame from the PixiJS ticker.
   */
  redraw() {
    this.graphics.clear();
    const now = Date.now();

    for (const trip of this.trips) {
      const duration = trip.arrivesAt - trip.departedAt;
      if (duration <= 0) continue;

      // Not started yet (pre-created return leg) — skip until its time comes
      if (trip.departedAt > now) continue;

      const elapsed = now - trip.departedAt;
      const progress = Math.max(0, Math.min(1, elapsed / duration));

      // Already arrived — skip (avoid frozen dot at destination)
      if (progress >= 1) continue;

      const x = trip.fromX + (trip.toX - trip.fromX) * progress;
      const y = trip.fromY + (trip.toY - trip.fromY) * progress;

      const color = PURPOSE_COLOR[trip.purpose] ?? 0xffffff;
      const radius = 4 + Math.min(trip.groupSize - 1, 4); // slightly bigger for larger groups

      // Glow ring
      this.graphics.circle(x, y, radius + 3);
      this.graphics.fill({ color, alpha: 0.2 });

      // Core dot
      this.graphics.circle(x, y, radius);
      this.graphics.fill({ color, alpha: 0.9 });
    }
  }

  destroy() {
    this.graphics.destroy();
    this.container.destroy();
  }
}
