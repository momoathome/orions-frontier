import { Container, Sprite, Text, Texture } from 'pixi.js';
import type { VisibleStation } from '@orions-frontier/shared';
import type { ChunkKey } from './ChunkStreamer.js';

export class StationLayer {
  readonly container = new Container();
  private chunks = new Map<ChunkKey, Container>();
  private stationsByChunk = new Map<ChunkKey, VisibleStation[]>();
  private texture: Texture = Texture.WHITE;
  private activeStationId: string | null = null;

  setTexture(texture: Texture): void {
    this.texture = texture;
  }

  setActiveStationId(stationId: string | null): void {
    this.activeStationId = stationId;
  }

  addChunk(key: ChunkKey, stations: VisibleStation[]): void {
    this.removeChunk(key);
    const chunk = new Container();
    const visibleStations = stations.filter((entry) => entry.id !== this.activeStationId);

    for (const station of visibleStations) {
      const sprite = new Sprite(this.texture);
      sprite.anchor.set(0.5);
      sprite.position.set(station.x, station.y);
      sprite.width = 72;
      sprite.height = 72;
      sprite.tint = station.isOwn ? 0x44aaff : station.ownerType === 'bot' ? 0x55d6a9 : 0xffd766;
      chunk.addChild(sprite);

      const label = new Text({
        text: `${station.isOwn ? '[OWN] ' : station.ownerType === 'bot' ? '[BOT] ' : ''}${station.name}`,
        style: {
          fontFamily: 'monospace',
          fontSize: 10,
          fill: station.isOwn ? 0x88ccff : station.ownerType === 'bot' ? 0x8fffd8 : 0xffe7a3,
        },
      });
      label.anchor.set(0.5, 1);
      label.position.set(station.x, station.y - 42);
      chunk.addChild(label);
    }

    this.stationsByChunk.set(key, visibleStations);
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
        if (distance <= tolerance && distance < nearestDistance) {
          nearest = station;
          nearestDistance = distance;
        }
      }
    }
    return nearest;
  }
}
