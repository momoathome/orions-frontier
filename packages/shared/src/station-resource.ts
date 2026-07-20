import type { ResourceMap } from './resource.js';

/** Response shape of GET /me/resources */
export interface UserResourceSummary {
  /** Aggregated resource amounts across all stations */
  resources: ResourceMap;
  /** Resources delivered during the last hour */
  rates: ResourceMap;
}
