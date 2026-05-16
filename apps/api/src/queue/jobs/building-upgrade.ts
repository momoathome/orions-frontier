import { BuildingUpgradeJobData } from '../queues/action-queue.js';
import { logger as rootLogger } from '../../lib/logger.js';

const logger = rootLogger.child({ name: 'queue-jobs' });

export const handleBuildingUpgradeFinished = async (data: BuildingUpgradeJobData) => {
  logger.info({ userId: data.userId, buildingKey: data.buildingKey }, 'Building upgrade finished');

  // TODO: Spiellogik ausführen (Gebäude-Level erhöhen, Ressourcen anpassen)
};
