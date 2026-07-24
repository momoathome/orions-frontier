import type { ResourceMap } from './resource.js';

/** Resource balance and recent deliveries for one station. */
export interface UserResourceSummary {
  /** Current resource amounts of one station */
  resources: ResourceMap;
  /** Resources delivered during the last hour */
  rates: ResourceMap;
  /** Maximum amount stored per individual resource. */
  storageCapacity: number;
}
