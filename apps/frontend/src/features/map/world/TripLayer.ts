import { Container, Graphics } from 'pixi.js';
import {
  getMiningTripPhase,
  isKeyOf,
  type SpacecraftRole,
  type WorldTripPurpose,
} from '@orions-frontier/shared';
import { ASTEROID_DEFAULT_RADIUS } from './constants.js';

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
  miningStartedAt?: number; // ms timestamp, mining_return only
}

export interface ActiveRadarContact {
  kind: 'radar_contact';
  id: string;
  x: number;
  y: number;
  observedAt: number;
  velocityX: number;
  velocityY: number;
  signature: SpacecraftRole | null;
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
  relocate: 0x88ccaa,
};

// ponytail: cap per-trip dots; switch to batched sprites if exact larger formations matter.
const MAX_VISIBLE_SHIPS = 25;
const SHIP_RADIUS = 3;
const SHIP_SPACING = 8;
const ORBIT_MARGIN = 8;
const ORBIT_PERIOD_MS = 120_000;
/** Time a mining group needs to fan out around the orbit after arrival, and to regroup before leaving. */
const ORBIT_FAN_MS = 4_000;

/** Visual radius of the loaded asteroid at a position, or null if none is loaded there. */
export type AsteroidRadiusLookup = (x: number, y: number) => number | null;

export class TripLayer {
  /** Add this to the world container */
  readonly container = new Container();

  private graphics = new Graphics();
  private trips: ActiveMovement[] = [];
  private scannerCircles: ScannerCircle[] = [];

  constructor(private asteroidRadiusAt: AsteroidRadiusLookup) {
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

  /** Point on the orbit facing the station: mining ships enter and leave the orbit here. */
  private approachPoint(asteroidX: number, asteroidY: number, stationX: number, stationY: number) {
    // Asteroid sprites are drawn at 2.4× their radius.
    const radius =
      (this.asteroidRadiusAt(asteroidX, asteroidY) ?? ASTEROID_DEFAULT_RADIUS) * 1.2 + ORBIT_MARGIN;
    const angle = Math.atan2(stationY - asteroidY, stationX - asteroidX);
    return {
      x: asteroidX + Math.cos(angle) * radius,
      y: asteroidY + Math.sin(angle) * radius,
      angle,
      radius,
    };
  }

  /** Mining ships drift around the asteroid in whole laps, so they leave where they arrived. */
  private drawOrbit(trip: ActiveTrip, now: number) {
    const approach = this.approachPoint(trip.fromX, trip.fromY, trip.toX, trip.toY);
    const startedAt = trip.miningStartedAt ?? trip.departedAt - ORBIT_PERIOD_MS;
    const duration = Math.max(trip.departedAt - startedAt, 1);
    const elapsed = Math.max(0, now - startedAt);
    const laps = Math.max(1, Math.round(duration / ORBIT_PERIOD_MS));
    const travelled = (elapsed / duration) * laps * Math.PI * 2;
    const fan = Math.max(0, Math.min(1, Math.min(elapsed, trip.departedAt - now) / ORBIT_FAN_MS));
    const shipCount = Math.min(Math.max(trip.groupSize, 1), MAX_VISIBLE_SHIPS);

    for (let index = 0; index < shipCount; index += 1) {
      const angle = approach.angle + travelled + fan * (index / shipCount) * Math.PI * 2;
      const shipX = trip.fromX + Math.cos(angle) * approach.radius;
      const shipY = trip.fromY + Math.sin(angle) * approach.radius;
      this.graphics.circle(shipX, shipY, SHIP_RADIUS + 3);
      this.graphics.fill({ color: PHASE_COLOR.mining, alpha: 0.2 });
      this.graphics.circle(shipX, shipY, SHIP_RADIUS);
      this.graphics.fill({ color: PHASE_COLOR.mining, alpha: 0.9 });
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
        // Unidentified civil traffic shows as a faint dot anywhere on the map.
        if (trip.signature === null) {
          this.graphics.circle(x, y, 2);
          this.graphics.fill({ color: 0xaab4c0, alpha: 0.45 });
          continue;
        }
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
        this.drawOrbit(trip, now);
        continue;
      }

      const duration = trip.arrivesAt - trip.departedAt;
      if (duration <= 0) continue;

      if (trip.departedAt > now) continue;

      const elapsed = now - trip.departedAt;
      const progress = Math.max(0, Math.min(1, elapsed / duration));

      // Already arrived — skip (avoid frozen dot at destination)
      if (progress >= 1) continue;

      let { fromX, fromY, toX, toY } = trip;
      if (miningPhase === 'outbound')
        ({ x: toX, y: toY } = this.approachPoint(toX, toY, fromX, fromY));
      if (miningPhase === 'returning') {
        ({ x: fromX, y: fromY } = this.approachPoint(fromX, fromY, toX, toY));
      }
      const x = fromX + (toX - fromX) * progress;
      const y = fromY + (toY - fromY) * progress;

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
