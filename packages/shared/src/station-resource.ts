import type { ResourceKey } from './resource.js';

export interface StationResource {
  stationId: string;
  resourceKey: ResourceKey;
  amount: number;
}
