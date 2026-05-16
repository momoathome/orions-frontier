import { Queue } from 'bullmq';
import { bullmqRedis } from '../bullmq.js';

export type ActionJobName = 'building-upgrade-finished';

export interface BuildingUpgradeJobData {
  userId: string;
  stationId: string;
  buildingKey: string;
}

export type ActionJobData = BuildingUpgradeJobData;

export const actionQueue = new Queue<ActionJobData, void, ActionJobName>('actions', {
  connection: bullmqRedis,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});
