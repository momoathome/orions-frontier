// ============================================================================
// world-gen/shapes.ts
// Asteroid field shape definitions and sampling.
//
// Shape Registry pattern: each shape is a self-contained object with three
// methods — buildParams, area, sample — so adding a new shape means adding one
// entry to SHAPE_REGISTRY without touching any switch statements.
// ============================================================================

import type { SeededRng } from './rng.js';

export type Point = { x: number; y: number };

export interface ShapeSpec {
  shapeKey: string;
  cx: number;
  cy: number;
  p: Record<string, number>;
}

// ── Shape definition interface ─────────────────────────────────────────────────

interface ShapeDefinition {
  /** Generate shape-specific parameters given a reference length and RNG. */
  buildParams(ref: number, rng: SeededRng): Record<string, number>;
  /** Approximate geometric area of the shape (used to derive asteroid count). */
  area(p: Record<string, number>): number;
  /** Sample `count` points from the shape. */
  sample(cx: number, cy: number, p: Record<string, number>, count: number, rng: SeededRng): Point[];
}

// ── Shape registry ─────────────────────────────────────────────────────────────

const SHAPE_REGISTRY: Record<string, ShapeDefinition> = {
  straight_line: {
    buildParams: (ref, rng) => ({
      angle: rng.next() * Math.PI,
      length: rng.nextFloat(ref * 0.12, ref * 0.60),
      width: rng.nextFloat(100, 400),
    }),
    area: (p) => p['length']! * p['width']!,
    sample: (cx, cy, p, count, rng) => {
      const cos = Math.cos(p['angle']!), sin = Math.sin(p['angle']!);
      const half = p['length']! / 2, halfW = p['width']! / 2;
      const pts: Point[] = [];
      for (let i = 0; i < count; i++) {
        const t = rng.nextFloat(-half, half);
        const w = rng.nextFloat(-halfW, halfW);
        pts.push({ x: cx + cos * t - sin * w, y: cy + sin * t + cos * w });
      }
      return pts;
    },
  },

  arc: {
    buildParams: (ref, rng) => ({
      radius: rng.nextFloat(ref * 0.08, ref * 0.40),
      startAngle: rng.next() * Math.PI * 2,
      arcAngle: rng.nextFloat(Math.PI * 0.5, Math.PI * 1.6),
      width: rng.nextFloat(80, 300),
    }),
    area: (p) => p['arcAngle']! * p['radius']! * p['width']!,
    sample: (cx, cy, p, count, rng) => {
      const halfW = p['width']! / 2;
      const pts: Point[] = [];
      for (let i = 0; i < count; i++) {
        const a = p['startAngle']! + rng.next() * p['arcAngle']!;
        const r = p['radius']! + rng.nextFloat(-halfW, halfW);
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      return pts;
    },
  },

  snake: {
    buildParams: (ref, rng) => ({
      angle: rng.next() * Math.PI,
      length: rng.nextFloat(ref * 0.12, ref * 0.55),
      width: rng.nextFloat(50, 180),
      amplitude: rng.nextFloat(60, 280),
      frequency: rng.nextFloat(0.007, 0.02),
    }),
    area: (p) => p['length']! * (p['width']! + p['amplitude']! * 0.7),
    sample: (cx, cy, p, count, rng) => {
      const cos = Math.cos(p['angle']!), sin = Math.sin(p['angle']!);
      const half = p['length']! / 2, halfW = p['width']! / 2;
      const pts: Point[] = [];
      for (let i = 0; i < count; i++) {
        const t = rng.nextFloat(-half, half);
        const wave = Math.sin(t * p['frequency']!) * p['amplitude']!;
        const w = wave + rng.nextFloat(-halfW, halfW);
        pts.push({ x: cx + cos * t - sin * w, y: cy + sin * t + cos * w });
      }
      return pts;
    },
  },

  crescent: {
    buildParams: (ref, rng) => ({
      radius: rng.nextFloat(ref * 0.08, ref * 0.35),
      thickness: rng.nextFloat(100, 320),
      startAngle: rng.next() * Math.PI * 2,
      arcAngle: rng.nextFloat(Math.PI * 0.4, Math.PI * 1.1),
    }),
    area: (p) => p['arcAngle']! * p['radius']! * p['thickness']!,
    sample: (cx, cy, p, count, rng) => {
      const halfT = p['thickness']! / 2;
      const pts: Point[] = [];
      for (let i = 0; i < count; i++) {
        const a = p['startAngle']! + rng.next() * p['arcAngle']!;
        const r = p['radius']! + rng.nextFloat(-halfT, halfT);
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      return pts;
    },
  },

  cloud: {
    buildParams: (ref, rng) => ({
      sigma: rng.nextFloat(ref * 0.05, ref * 0.28),
    }),
    area: (p) => Math.PI * (2 * p['sigma']!) ** 2,
    sample: (cx, cy, p, count, rng) => {
      const sigma = p['sigma']!;
      const pts: Point[] = [];
      for (let i = 0; i < count; i++) {
        const u1 = Math.max(1e-10, rng.next());
        const u2 = rng.next();
        const mag = sigma * Math.sqrt(-2 * Math.log(u1));
        pts.push({
          x: cx + mag * Math.cos(2 * Math.PI * u2),
          y: cy + mag * Math.sin(2 * Math.PI * u2),
        });
      }
      return pts;
    },
  },

  dense_disk: {
    buildParams: (ref, rng) => ({
      radius: rng.nextFloat(ref * 0.06, ref * 0.28),
    }),
    area: (p) => Math.PI * p['radius']! ** 2,
    sample: (cx, cy, p, count, rng) => {
      const pts: Point[] = [];
      for (let i = 0; i < count; i++) {
        const r = p['radius']! * Math.sqrt(rng.next());
        const a = rng.next() * 2 * Math.PI;
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      return pts;
    },
  },
};

const FALLBACK_SHAPE_KEY = 'dense_disk';

function getShape(shapeKey: string): ShapeDefinition {
  return SHAPE_REGISTRY[shapeKey] ?? SHAPE_REGISTRY[FALLBACK_SHAPE_KEY]!;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Generates a ShapeSpec for the given shape key, with its center placed
 * randomly within the sector (15% margin from sector edges).
 */
export function buildShapeSpec(
  shapeKey: string,
  sectorCenterX: number,
  sectorCenterY: number,
  halfW: number,
  halfH: number,
  rng: SeededRng,
): ShapeSpec {
  const margin = 0.15;
  const cx = sectorCenterX + rng.nextFloat(-halfW * (1 - margin), halfW * (1 - margin));
  const cy = sectorCenterY + rng.nextFloat(-halfH * (1 - margin), halfH * (1 - margin));
  const ref = Math.min(halfW, halfH);
  const p = getShape(shapeKey).buildParams(ref, rng);
  return { shapeKey, cx, cy, p };
}

/** Approximate geometric area of a shape spec (used to derive asteroid count). */
export function shapeArea(spec: ShapeSpec): number {
  return getShape(spec.shapeKey).area(spec.p);
}

/** Sample `count` points from a shape spec using the given RNG. */
export function sampleShapeSpec(spec: ShapeSpec, count: number, rng: SeededRng): Point[] {
  return getShape(spec.shapeKey).sample(spec.cx, spec.cy, spec.p, count, rng);
}
