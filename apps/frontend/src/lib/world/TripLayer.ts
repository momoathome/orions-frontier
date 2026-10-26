import { Container, Graphics } from 'pixi.js';
import {
  getMiningTripPhase,
  isKeyOf,
  type SpacecraftRole,
  type WorldTripPurpose,
} from '@orions-frontier/shared';

// TripLayer
// Renders in-flight spacecraft as animated dots moving along their trip path.
// Position is interpolated client-side from departedAt/arrivesAt timestamps —
// no polling needed. The layer redraws each ticker frame.
//
// Add TripLayer.container to the worldContainer so it moves with the camera.
// Call redraw() each frame and setTrips() when trip data changes.

export interface ActiveTrip {
  kind: 'own_trip';
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  departedAt: number; // ms timestamp
  arrivesAt: number; // ms timestamp
  purpose: WorldTripPurpose;
  groupSize: number;
}

export interface ActiveRadarContact {
  kind: 'radar_contact';
  id: string;
  x: number;
  y: number;
  observedAt: number;
  velocityX: number;
  velocityY: number;
  signature: SpacecraftRole;
}

export type ActiveMovement = ActiveTrip | ActiveRadarContact;

interface ScannerCircle {
  x: number;
  y: number;
  range: number;
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

// ponytail: cap per-trip dots; switch to batched sprites if exact larger formations matter.
const MAX_VISIBLE_SHIPS = 25;
const SHIP_RADIUS = 3;
const SHIP_SPACING = 8;

export class TripLayer {
  /** Add this to the world container */
  readonly container = new Container();

  private graphics = new Graphics();
  private trips: ActiveMovement[] = [];
  private scannerCircles: ScannerCircle[] = [];

  constructor() {
    this.container.addChild(this.graphics);
  }

  setTrips(trips: ActiveMovement[]) {
    this.trips = trips;
  }

  setScannerCircles(circles: ScannerCircle[]) {
    this.scannerCircles = circles;
  }

  private drawFormation(x: number, y: number, color: number, groupSize: number) {
    const shipCount = Math.min(Math.max(groupSize, 1), MAX_VISIBLE_SHIPS);
    const columns = Math.ceil(Math.sqrt(shipCount));
    const rows = Math.ceil(shipCount / columns);

    for (let row = 0; row < rows; row += 1) {
      const rowCount = Math.min(columns, shipCount - row * columns);
      for (let column = 0; column < rowCount; column += 1) {
        const shipX = x + (column - (rowCount - 1) / 2) * SHIP_SPACING;
        const shipY = y + (row - (rows - 1) / 2) * SHIP_SPACING;

        this.graphics.circle(shipX, shipY, SHIP_RADIUS + 3);
        this.graphics.fill({ color, alpha: 0.2 });
        this.graphics.circle(shipX, shipY, SHIP_RADIUS);
        this.graphics.fill({ color, alpha: 0.9 });
      }
    }
  }

  /**
   * Redraws all in-flight ship markers at their interpolated positions.
   * Call this every frame from the PixiJS ticker.
   */
  redraw() {
    this.graphics.clear();
    const now = Date.now();

    for (const trip of this.trips) {
      if (trip.kind === 'radar_contact') {
        const elapsedSeconds = Math.max(0, Math.min(7.5, (now - trip.observedAt) / 1_000));
        const x = trip.x + trip.velocityX * elapsedSeconds;
        const y = trip.y + trip.velocityY * elapsedSeconds;
        const visible = this.scannerCircles.some((circle) => {
          const dx = x - circle.x;
          const dy = y - circle.y;
          return dx * dx + dy * dy <= circle.range * circle.range;
        });
        if (!visible) continue;
        const color = trip.signature === 'fighter' ? 0xff5555 : 0x66ddff;
        const pulse = 2 + Math.sin(now / 180);
        this.graphics.circle(x, y, 7 + pulse);
        this.graphics.stroke({ color, alpha: 0.55, width: 1 });
        this.graphics.circle(x, y, 3);
        this.graphics.fill({ color, alpha: 0.9 });
        continue;
      }
      const miningPhase = getMiningTripPhase(trip, now);

      if (miningPhase === 'mining') {
        const pulse = 2 + 1.5 * Math.sin(now / 250);
        const formationRadius =
          Math.ceil(Math.sqrt(Math.min(trip.groupSize, MAX_VISIBLE_SHIPS))) * 4;
        this.graphics.circle(trip.fromX, trip.fromY, formationRadius + 5 + pulse);
        this.graphics.stroke({ color: PHASE_COLOR.mining, alpha: 0.55, width: 1.5 });
        this.drawFormation(trip.fromX, trip.fromY, PHASE_COLOR.mining, trip.groupSize);
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
        : isKeyOf(PURPOSE_COLOR, trip.purpose)
          ? PURPOSE_COLOR[trip.purpose]
          : 0xffffff;

      if (miningPhase) {
        this.drawFormation(x, y, color, trip.groupSize);
        continue;
      }

      const radius = 4 + Math.min(trip.groupSize - 1, 4);
      this.graphics.circle(x, y, radius + 3);
      this.graphics.fill({ color, alpha: 0.2 });
      this.graphics.circle(x, y, radius);
      this.graphics.fill({ color, alpha: 0.9 });
    }
  }
}
