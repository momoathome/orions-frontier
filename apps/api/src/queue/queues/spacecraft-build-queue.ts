import { Queue } from 'bullmq';
import { bullmqRedis } from '../bullmq.js';

export type SpacecraftBuildJobName = 'spacecraft-build';

export interface SpacecraftBuildJobData {
  userId: string;
  stationId: string;
  spacecraftDefinitionId: string;
  spacecraftKey: string;
  orderId: string;
  amount: number;
}

export const spacecraftBuildQueue = new Queue<SpacecraftBuildJobData, void, SpacecraftBuildJobName>(
  'spacecraft-build',
  {
    connection: bullmqRedis,
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  }
);
