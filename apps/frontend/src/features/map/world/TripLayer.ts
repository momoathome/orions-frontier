import { Container, Graphics } from 'pixi.js';
import {
  getMiningTripPhase,
  isKeyOf,
  type SpacecraftRole,
  type WorldTripPurpose,
} from '@orions-frontier/shared';
import { ASTEROID_DEFAULT_RADIUS } from './constants.js';
import { gameNow } from '../../../shared/lib/live.js';

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

// known-limit: cap per-trip dots; switch to batched sprites if exact larger formations matter.
const MAX_VISIBLE_SHIPS = 25;
const SHIP_RADIUS = 3;
const SHIP_SPACING = 8;
const ORBIT_MARGIN = 8;
const ORBIT_PERIOD_MS = 120_000;
/** Time a mining group needs to fan out around the orbit after arrival, and to regroup before leaving. */
const ORBIT_FAN_MS = 4_000;
/** Unidentified traffic: neutral, but bright enough to read at the widest zoom. */
const CONTACT_COLOR = 0xc8d2e0;
/** A wake shows where a contact came from over the last seconds, capped for fast ships. */
const WAKE_SECONDS = 6;
const WAKE_MAX_LENGTH = 90;
const WAKE_SEGMENTS = 3;
/**
 * Ships are a few world units wide; zoomed far out they keep at least this radius on screen.
 * Stations do not grow, so ships stay a speck beside them instead of outgrowing them.
 */
const MIN_SHIP_PX = 1;
const MIN_WAKE_PX = 8;

/**
 * Corners for a dot of this on-screen radius. Pixi sizes circles by world radius, so markers
 * grown for a wide zoom would tessellate four times the vertices they need.
 */
const dotSides = (screenRadius: number) => Math.min(32, Math.max(8, Math.ceil(screenRadius * 2)));

/** Stable start angle per contact, so blips sharing an asteroid spread around it. */
const idAngle = (id: string) => {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return ((hash >>> 0) % 360) * (Math.PI / 180);
};

/** Visual radius of the loaded asteroid at a position, or null if none is loaded there. */
export type AsteroidRadiusLookup = (x: number, y: number) => number | null;

export class TripLayer {
  /** Add this to the world container */
  readonly container = new Container();

  private graphics = new Graphics();
  private trips: ActiveMovement[] = [];
  /** Null in the admin scanner bypass: every identified contact is drawn. */
  private scannerCircles: ScannerCircle[] | null = [];
  private zoom = 1;
  /** Grows ship markers once the camera zooms out far enough to shrink them below MIN_SHIP_PX. */
  private scale = 1;

  constructor(private asteroidRadiusAt: AsteroidRadiusLookup) {
    this.container.addChild(this.graphics);
  }

  setTrips(trips: ActiveMovement[]) {
    this.trips = trips;
  }

  setScannerCircles(circles: ScannerCircle[] | null) {
    this.scannerCircles = circles;
  }

  /** Call each frame with the camera zoom. */
  setZoom(zoom: number) {
    this.zoom = zoom;
    this.scale = Math.max(1, MIN_SHIP_PX / (SHIP_RADIUS * zoom));
  }

  private drawFormation(x: number, y: number, color: number, groupSize: number) {
    const shipCount = Math.min(Math.max(groupSize, 1), MAX_VISIBLE_SHIPS);
    const columns = Math.ceil(Math.sqrt(shipCount));
    const rows = Math.ceil(shipCount / columns);
    const radius = SHIP_RADIUS * this.scale;
    // Spacing stays in world units: zoomed out, a group merges into one speck.
    const spacing = SHIP_SPACING;

    for (let row = 0; row < rows; row += 1) {
      const rowCount = Math.min(columns, shipCount - row * columns);
      for (let column = 0; column < rowCount; column += 1) {
        const shipX = x + (column - (rowCount - 1) / 2) * spacing;
        const shipY = y + (row - (rows - 1) / 2) * spacing;

        this.graphics.circle(shipX, shipY, radius * 2);
        this.graphics.fill({ color, alpha: 0.2 });
        this.graphics.circle(shipX, shipY, radius);
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
    const radius = SHIP_RADIUS * this.scale;

    for (let index = 0; index < shipCount; index += 1) {
      const angle = approach.angle + travelled + fan * (index / shipCount) * Math.PI * 2;
      const shipX = trip.fromX + Math.cos(angle) * approach.radius;
      const shipY = trip.fromY + Math.sin(angle) * approach.radius;
      this.graphics.circle(shipX, shipY, radius * 2);
      this.graphics.fill({ color: PHASE_COLOR.mining, alpha: 0.2 });
      this.graphics.circle(shipX, shipY, radius);
      this.graphics.fill({ color: PHASE_COLOR.mining, alpha: 0.9 });
    }
  }

  /**
   * Foreign traffic: a blip with a fading wake along its heading; a halted blip at an asteroid
   * circles it, so mining shows. The scanner only adds the signature colour and pulse.
   * Contacts are batched per colour: one path per style keeps a busy sky to a few draw calls.
   */
  private drawContacts(contacts: ActiveRadarContact[], now: number) {
    const buckets = new Map<number, { blips: number[]; wakes: number[]; identified: boolean }>();
    for (const contact of contacts) {
      const elapsedSeconds = Math.max(0, Math.min(7.5, (now - contact.observedAt) / 1_000));
      let x = contact.x + contact.velocityX * elapsedSeconds;
      let y = contact.y + contact.velocityY * elapsedSeconds;
      const inScanner =
        this.scannerCircles?.some((circle) => {
          const dx = x - circle.x;
          const dy = y - circle.y;
          return dx * dx + dy * dy <= circle.range * circle.range;
        }) ?? true;
      // A contact extrapolated past the scanner edge falls back to an anonymous blip.
      const signature = inScanner ? contact.signature : null;
      const color =
        signature === null ? CONTACT_COLOR : signature === 'fighter' ? 0xff5555 : 0x66ddff;
      let bucket = buckets.get(color);
      if (!bucket) {
        bucket = { blips: [], wakes: [], identified: signature !== null };
        buckets.set(color, bucket);
      }

      const speed = Math.hypot(contact.velocityX, contact.velocityY);
      if (speed > 0) {
        const wake =
          Math.max(Math.min(speed * WAKE_SECONDS, WAKE_MAX_LENGTH), MIN_WAKE_PX / this.zoom) /
          speed;
        bucket.wakes.push(x, y, -contact.velocityX * wake, -contact.velocityY * wake);
      } else {
        const asteroidRadius = this.asteroidRadiusAt(contact.x, contact.y);
        if (asteroidRadius !== null) {
          const radius = asteroidRadius * 1.2 + ORBIT_MARGIN;
          const angle = (now / ORBIT_PERIOD_MS) * Math.PI * 2 + idAngle(contact.id);
          x = contact.x + Math.cos(angle) * radius;
          y = contact.y + Math.sin(angle) * radius;
        }
      }
      bucket.blips.push(x, y);
    }

    const g = this.graphics;
    const { scale } = this;
    const radius = SHIP_RADIUS * scale;
    const pulse = (9 + Math.sin(now / 180)) * scale;
    const coreSides = dotSides(radius * this.zoom);
    const haloSides = dotSides(radius * 2 * this.zoom);
    const pulseSides = dotSides(pulse * this.zoom);
    for (const [color, { blips, wakes, identified }] of buckets) {
      // The wake fades in segments, oldest part faintest.
      for (let segment = 0; segment < WAKE_SEGMENTS; segment += 1) {
        const from = (segment + 1) / WAKE_SEGMENTS;
        const to = segment / WAKE_SEGMENTS;
        for (let index = 0; index < wakes.length; index += 4) {
          const x = wakes[index] ?? 0;
          const y = wakes[index + 1] ?? 0;
          const dx = wakes[index + 2] ?? 0;
          const dy = wakes[index + 3] ?? 0;
          g.moveTo(x + dx * from, y + dy * from);
          g.lineTo(x + dx * to, y + dy * to);
        }
        if (wakes.length > 0) g.stroke({ color, alpha: 0.35 * (1 - to), width: 1.5 * scale });
      }
      if (identified) {
        for (let index = 0; index < blips.length; index += 2) {
          g.regularPoly(blips[index] ?? 0, blips[index + 1] ?? 0, pulse, pulseSides);
        }
        g.stroke({ color, alpha: 0.55, width: scale });
      }
      for (let index = 0; index < blips.length; index += 2) {
        g.regularPoly(blips[index] ?? 0, blips[index + 1] ?? 0, radius * 2, haloSides);
      }
      g.fill({ color, alpha: 0.15 });
      for (let index = 0; index < blips.length; index += 2) {
        g.regularPoly(blips[index] ?? 0, blips[index + 1] ?? 0, radius, coreSides);
      }
      g.fill({ color, alpha: identified ? 0.9 : 0.75 });
    }
  }

  /**
   * Redraws all in-flight ship markers at their interpolated positions.
   * Call this every frame from the PixiJS ticker.
   */
  redraw() {
    this.graphics.clear();
    const now = gameNow();
    this.drawContacts(
      this.trips.filter((trip) => trip.kind === 'radar_contact'),
      now
    );

    for (const trip of this.trips) {
      if (trip.kind === 'radar_contact') continue;
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

      const radius = Math.max(4 + Math.min(trip.groupSize - 1, 4), SHIP_RADIUS * this.scale);
      this.graphics.circle(x, y, radius + 3 * this.scale);
      this.graphics.fill({ color, alpha: 0.2 });
      this.graphics.circle(x, y, radius);
      this.graphics.fill({ color, alpha: 0.9 });
    }
  }
}
