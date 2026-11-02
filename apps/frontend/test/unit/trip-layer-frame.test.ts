import { expect, test } from 'vitest';
import { TripLayer, type ActiveMovement } from '../../src/features/map/world/TripLayer';

// A busy viewport at the widest zoom: every bot sector around the player is in view.
const CONTACTS = 1_500;
const OWN_TRIPS = 60;
const FRAMES = 120;
/** A fifth of a 60 Hz frame, so tessellation and the GPU keep the rest. */
const BUDGET_MS = 3.3;

function busySky(now: number): ActiveMovement[] {
  const movements: ActiveMovement[] = [];
  for (let index = 0; index < CONTACTS; index += 1) {
    const halted = index % 3 === 0;
    movements.push({
      kind: 'radar_contact',
      id: `contact-${index}`,
      x: (index % 50) * 300,
      y: Math.floor(index / 50) * 300,
      observedAt: now,
      velocityX: halted ? 0 : 40,
      velocityY: halted ? 0 : -25,
      signature: index % 4 === 0 ? 'fighter' : index % 4 === 1 ? 'miner' : null,
    });
  }
  for (let index = 0; index < OWN_TRIPS; index += 1) {
    movements.push({
      kind: 'own_trip',
      id: `trip-${index}`,
      fromX: 0,
      fromY: 0,
      toX: 4_000,
      toY: index * 50,
      departedAt: now - 10_000,
      arrivesAt: now + 50_000,
      purpose: index % 2 ? 'mine' : 'combat',
      groupSize: 12,
    });
  }
  return movements;
}

test('redrawing a busy sky stays well inside one frame', () => {
  // Every halted contact sits at an asteroid, the costlier orbit path.
  const layer = new TripLayer(() => 24);
  layer.setScannerCircles([{ x: 0, y: 0, range: 3_300 }]);
  layer.setZoom(0.06);
  layer.setTrips(busySky(Date.now()));

  for (let frame = 0; frame < 10; frame += 1) layer.redraw(); // warm up the JIT
  const started = performance.now();
  for (let frame = 0; frame < FRAMES; frame += 1) layer.redraw();
  const perFrame = (performance.now() - started) / FRAMES;

  console.info(`TripLayer.redraw: ${perFrame.toFixed(2)} ms/frame for ${CONTACTS} contacts`);
  expect(perFrame).toBeLessThan(BUDGET_MS);
});
