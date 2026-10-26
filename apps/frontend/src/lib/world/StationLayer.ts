import { Container, Text } from 'pixi.js';
import type { VisibleStation } from '@orions-frontier/shared';
import type { ChunkKey } from './ChunkStreamer.js';
import { createStationVisual, stationVisualRadius, type StationVisual } from './StationVisual.js';

export class StationLayer {
  readonly container = new Container();
  private chunks = new Map<ChunkKey, Container>();
  private stationsByChunk = new Map<ChunkKey, VisibleStation[]>();
  private visualsByChunk = new Map<ChunkKey, StationVisual[]>();
  private labelsByChunk = new Map<ChunkKey, Text[]>();
  private activeStationId: string | null = null;

  setActiveStationId(stationId: string | null): void {
    this.activeStationId = stationId;
  }

  addChunk(key: ChunkKey, stations: VisibleStation[]): void {
    this.removeChunk(key);
    const chunk = new Container();
    const visibleStations = stations.filter((entry) => entry.id !== this.activeStationId);
    const visuals: StationVisual[] = [];
    const labels: Text[] = [];

    for (const station of visibleStations) {
      const visual = createStationVisual(station);
      // Unscanned stations use a placeholder profile; dim them so they read as distant contacts.
      if (!station.scanned) visual.container.alpha = 0.45;
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
      if (!station.scanned) label.alpha = 0.6;
      labels.push(label);
      chunk.addChild(label);
    }

    this.stationsByChunk.set(key, visibleStations);
    this.visualsByChunk.set(key, visuals);
    this.labelsByChunk.set(key, labels);
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
    this.labelsByChunk.delete(key);
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
    // Keep names readable when zoomed out so neighbours stay identifiable on the overview.
    const labelScale = zoom < 1 ? 1 / zoom : 1;
    for (const labels of this.labelsByChunk.values()) {
      for (const label of labels) label.scale.set(labelScale);
    }
  }
}
