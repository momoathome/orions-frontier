import { Container, Graphics } from 'pixi.js';
import type { DebrisField } from '@orions-frontier/shared';
import type { ChunkKey } from './ChunkStreamer.js';

export class DebrisLayer {
  readonly container = new Container();
  private chunks = new Map<ChunkKey, Container>();
  private fields = new Map<ChunkKey, DebrisField[]>();

  addChunk(key: ChunkKey, fields: DebrisField[]): void {
    this.removeChunk(key);
    const chunk = new Container();
    for (const field of fields) {
      const marker = new Graphics();
      marker.circle(field.x, field.y, 15).fill({ color: 0x9d70ff, alpha: 0.22 });
      marker.circle(field.x, field.y, 9).stroke({ color: 0xc5a7ff, alpha: 0.9, width: 2 });
      marker.moveTo(field.x - 7, field.y).lineTo(field.x + 7, field.y);
      marker.moveTo(field.x, field.y - 7).lineTo(field.x, field.y + 7);
      marker.stroke({ color: 0xe7dbff, alpha: 0.8, width: 1 });
      chunk.addChild(marker);
    }
    this.fields.set(key, fields);
    this.chunks.set(key, chunk);
    this.container.addChild(chunk);
  }

  removeChunk(key: ChunkKey): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    this.container.removeChild(chunk);
    chunk.destroy({ children: true });
    this.chunks.delete(key);
    this.fields.delete(key);
  }

  clear(): void {
    for (const key of [...this.chunks.keys()]) this.removeChunk(key);
  }

  hitTest(x: number, y: number, tolerance: number): DebrisField | null {
    let nearest: DebrisField | null = null;
    let nearestDistance = Infinity;
    for (const fields of this.fields.values()) {
      for (const field of fields) {
        const distance = Math.hypot(x - field.x, y - field.y);
        if (distance <= Math.max(16, tolerance) && distance < nearestDistance) {
          nearest = field;
          nearestDistance = distance;
        }
      }
    }
    return nearest;
  }
}
