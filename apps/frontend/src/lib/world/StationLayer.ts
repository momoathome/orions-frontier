import { Container, Text } from 'pixi.js';
import type { VisibleStation } from '@orions-frontier/shared';
import type { ChunkKey } from './ChunkStreamer.js';
import { createStationVisual, stationVisualRadius, type StationVisual } from './StationVisual.js';

export class StationLayer {
  readonly container = new Container();
  private chunks = new Map<ChunkKey, Container>();
  private stationsByChunk = new Map<ChunkKey, VisibleStation[]>();
  private visualsByChunk = new Map<ChunkKey, StationVisual[]>();
  private activeStationId: string | null = null;

  setActiveStationId(stationId: string | null): void {
    this.activeStationId = stationId;
  }

  addChunk(key: ChunkKey, stations: VisibleStation[]): void {
    this.removeChunk(key);
    const chunk = new Container();
    const visibleStations = stations.filter((entry) => entry.id !== this.activeStationId);
    const visuals: StationVisual[] = [];

    for (const station of visibleStations) {
      const visual = createStationVisual(station);
      visuals.push(visual);
      chunk.addChild(visual.container);

      const label = new Text({
        text: `${station.isOwn ? '[OWN] ' : station.ownerType === 'bot' ? '[BOT] ' : ''}${station.name}`,
        style: {
          fontFamily: 'monospace',
          fontSize: 10,
          fill: station.isOwn ? 0x88ccff : station.ownerType === 'bot' ? 0x8fffd8 : 0xffe7a3,
        },
      });
      label.anchor.set(0.5, 1);
      label.position.set(station.x, station.y - visual.radius - 8);
      chunk.addChild(label);
    }

    this.stationsByChunk.set(key, visibleStations);
    this.visualsByChunk.set(key, visuals);
    this.chunks.set(key, chunk);
    this.container.addChild(chunk);
  }

  removeChunk(key: ChunkKey): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    this.container.removeChild(chunk);
    chunk.destroy({ children: true });
    this.chunks.delete(key);
    this.stationsByChunk.delete(key);
    this.visualsByChunk.delete(key);
  }

  clear(): void {
    for (const key of [...this.chunks.keys()]) this.removeChunk(key);
  }

  hitTest(x: number, y: number, tolerance: number): VisibleStation | null {
    // ponytail: a sector contains few stations; add a spatial index when that stops being true.
    let nearest: VisibleStation | null = null;
    let nearestDistance = Infinity;
    for (const stations of this.stationsByChunk.values()) {
      for (const station of stations) {
        const distance = Math.hypot(x - station.x, y - station.y);
        const radius = Math.max(stationVisualRadius(station.visualProfile), tolerance);
        if (distance <= radius && distance < nearestDistance) {
          nearest = station;
          nearestDistance = distance;
        }
      }
    }
    return nearest;
  }

  animate(timeMs: number, zoom: number): void {
    for (const visuals of this.visualsByChunk.values()) {
      for (const visual of visuals) visual.animate(timeMs, zoom);
    }
  }
}
