// travel.ts — Utilities for time-based spacecraft travel calculations.
//
// All spacecraft travel in real time. Travel time is derived from:
//   travelHours = euclideanDistance(from, to) / (speed × TRAVEL_SPEED_FACTOR)
//
// The arrivesAt timestamp is stored on the spacecraft_trip record.
// Map position during travel is interpolated client-side — no polling needed.

import { WORLD_CONFIG } from './world-config.js';

export interface Coordinate {
  x: number;
  y: number;
}

/** Euclidean distance between two world-space coordinates. */
export function calcDistance(from: Coordinate, to: Coordinate): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/** Travel duration in real-time hours. */
export function calcTravelHours(distance: number, speed: number): number {
  if (!Number.isFinite(distance) || distance < 0) {
    throw new RangeError('distance must be a finite number greater than or equal to 0');
  }
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new RangeError('speed must be a finite number greater than 0');
  }
  return distance / (speed * WORLD_CONFIG.TRAVEL_SPEED_FACTOR);
}

/**
 * Calculate the arrival timestamp for a spacecraft trip.
 * @param departedAt  Departure time
 * @param distance    Euclidean distance in world units
 * @param speed       Spacecraft speed from the game config
 * @returns           Arrival Date
 */
export function calcArrivesAt(departedAt: Date, distance: number, speed: number): Date {
  const travelHours = calcTravelHours(distance, speed);
  const travelMs = travelHours * 3_600_000;
  return new Date(departedAt.getTime() + travelMs);
}
