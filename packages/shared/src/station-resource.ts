import type { ResourceKey, ResourceMap } from './resource.js';

export interface StationResource {
  stationId: string;
  resourceKey: ResourceKey;
  amount: number;
}

/** Response shape of GET /me/resources */
export interface UserResourceSummary {
  /** Aggregated resource amounts across all stations */
  resources: ResourceMap;
  /** Theoretical mining rates in units/h per resource across all stations */
  rates: ResourceMap;
}
