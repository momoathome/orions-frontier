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
  /**
   * Effective delivery rates in units/h — resources actually received at station
   * via transporter/recall trips in the last hour. Lower than `rates` when
   * miners are traveling, recalling, or transporters are scarce.
   */
  effectiveRates: ResourceMap;
}
