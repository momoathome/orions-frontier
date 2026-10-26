import type { SeededRng } from './rng.js';

export interface Point {
  x: number;
  y: number;
}

export function sampleCloud(
  cx: number,
  cy: number,
  radius: number,
  count: number,
  rng: SeededRng
): Point[] {
  return Array.from({ length: count }, () => {
    const distance = radius * Math.sqrt(rng.next());
    const angle = rng.next() * Math.PI * 2;
    return { x: cx + Math.cos(angle) * distance, y: cy + Math.sin(angle) * distance };
  });
}

export function sampleBelt(
  cx: number,
  cy: number,
  length: number,
  width: number,
  count: number,
  rng: SeededRng
): Point[] {
  const angle = rng.next() * Math.PI;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return Array.from({ length: count }, () => {
    const along = rng.nextFloat(-length / 2, length / 2);
    const across = rng.nextFloat(-width / 2, width / 2);
    return {
      x: cx + cos * along - sin * across,
      y: cy + sin * along + cos * across,
    };
  });
}
