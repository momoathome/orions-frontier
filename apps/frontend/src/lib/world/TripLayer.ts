import { Container, Graphics } from 'pixi.js';
import { getMiningTripPhase } from '@orions-frontier/shared';

// TripLayer
// Renders in-flight spacecraft as animated dots moving along their trip path.
// Position is interpolated client-side from departedAt/arrivesAt timestamps —
// no polling needed. The layer redraws each ticker frame.
//
// Add TripLayer.container to the worldContainer so it moves with the camera.
// Call redraw() each frame and setTrips() when trip data changes.

export interface ActiveTrip {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  departedAt: number; // ms timestamp
  arrivesAt: number; // ms timestamp
  purpose:
    | 'mine'
    | 'mining_return'
    | 'combat'
    | 'combat_return'
    | 'expedition'
    | 'colonization'
    | 'salvage'
    | 'salvage_return';
  groupSize: number;
}

const PHASE_COLOR = {
  outbound: 0x44aaff,
  mining: 0xffcc44,
  returning: 0xff8a22,
} as const;

const PURPOSE_COLOR: Record<Exclude<ActiveTrip['purpose'], 'mine' | 'mining_return'>, number> = {
  combat: 0xff4444, // red
  combat_return: 0xff7777,
  expedition: 0xaa88ff,
  colonization: 0xffcc66,
  salvage: 0xbb88ff,
  salvage_return: 0xddbbff,
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
      const miningPhase = getMiningTripPhase(trip, now);
      const radius = 4 + Math.min(trip.groupSize - 1, 4);

      if (miningPhase === 'mining') {
        const pulse = 2 + 1.5 * Math.sin(now / 250);
        this.graphics.circle(trip.fromX, trip.fromY, radius + 5 + pulse);
        this.graphics.stroke({ color: PHASE_COLOR.mining, alpha: 0.55, width: 1.5 });
        this.graphics.circle(trip.fromX, trip.fromY, radius);
        this.graphics.fill({ color: PHASE_COLOR.mining, alpha: 0.95 });
        continue;
      }

      const duration = trip.arrivesAt - trip.departedAt;
      if (duration <= 0) continue;

      if (trip.departedAt > now) continue;

      const elapsed = now - trip.departedAt;
      const progress = Math.max(0, Math.min(1, elapsed / duration));

      // Already arrived — skip (avoid frozen dot at destination)
      if (progress >= 1) continue;

      const x = trip.fromX + (trip.toX - trip.fromX) * progress;
      const y = trip.fromY + (trip.toY - trip.fromY) * progress;

      const color = miningPhase
        ? PHASE_COLOR[miningPhase]
        : (PURPOSE_COLOR[trip.purpose as keyof typeof PURPOSE_COLOR] ?? 0xffffff);

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
