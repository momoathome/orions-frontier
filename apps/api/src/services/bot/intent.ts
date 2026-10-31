import type { BuildingKey, DefenseUpgradeKey } from '@orions-frontier/shared';
import { AppError } from '@orions-frontier/shared';
import { createAsteroidAssignment } from '../mining/index.js';
import { buildSpacecrafts, startBuildingUpgrade, startDefenseUpgrade } from '../station/index.js';
import { startResearch } from '../research/index.js';
import { startColonization, startExpedition } from '../missions/index.js';
import { startAttack, startSalvage } from '../combat/index.js';
import {
  resolveGameExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';

export type BotIntent =
  | {
      type: 'assign_miner';
      stationId: string;
      asteroidId: string;
      spacecraftKey: string;
      amount: number;
    }
  | { type: 'build_spacecraft'; stationId: string; spacecraftKey: string; amount: number }
  | { type: 'upgrade_building'; stationId: string; buildingKey: BuildingKey }
  | { type: 'start_research'; stationId: string; technologyKey: string }
  | { type: 'start_expedition'; stationId: string; sectorX: number; sectorY: number }
  | {
      type: 'start_colonization';
      stationId: string;
      sectorX: number;
      sectorY: number;
      name: string;
    }
  | { type: 'upgrade_defense'; stationId: string; upgradeKey: DefenseUpgradeKey }
  | {
      type: 'start_attack';
      stationId: string;
      targetStationId: string;
      fleet: Record<string, number>;
    }
  | {
      type: 'start_salvage';
      stationId: string;
      debrisFieldId: string;
      spacecraftKey: string;
      amount: number;
    };

export type BotIntentRejectionKind = 'waiting' | 'saving' | 'blocked';
const PROTECTED_TARGET_RETRY_MS = 60 * 60_000;

export class BotIntentRejected extends Error {
  constructor(
    public readonly kind: BotIntentRejectionKind,
    message: string,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'BotIntentRejected';
  }
}

function classifyDomainError(error: AppError): BotIntentRejected {
  const message = error.message;
  if (/protected from attacks/i.test(message)) {
    return new BotIntentRejected('waiting', message, PROTECTED_TARGET_RETRY_MS);
  }
  if (
    /already underway|already upgrading|already started|already running|no free (build|research) slot|not enough spacecraft|no (miner|spacecraft) is available|spacecraft available|no spacecraft of this type|assigned by another request/i.test(
      message
    )
  ) {
    return new BotIntentRejected('waiting', message);
  }
  if (/insufficient/i.test(message)) {
    return new BotIntentRejected('saving', message);
  }
  return new BotIntentRejected('blocked', message);
}

/** Execute one bot action through the same authoritative domain service used by player routes. */
export async function executeBotIntent(
  userId: string,
  intent: BotIntent,
  contextOrNow: GameExecutionContext | Date
): Promise<void> {
  const context = resolveGameExecutionContext(contextOrNow);
  try {
    switch (intent.type) {
      case 'assign_miner':
        await createAsteroidAssignment(
          {
            userId,
            stationId: intent.stationId,
            asteroidId: intent.asteroidId,
            spacecraftKey: intent.spacecraftKey,
            assignedAmount: intent.amount,
          },
          context
        );
        break;
      case 'build_spacecraft':
        await buildSpacecrafts(
          intent.stationId,
          userId,
          [{ spacecraftKey: intent.spacecraftKey, amount: intent.amount }],
          context
        );
        break;
      case 'upgrade_building':
        await startBuildingUpgrade(intent.stationId, intent.buildingKey, userId, context);
        break;
      case 'start_research':
        await startResearch(userId, intent.stationId, intent.technologyKey, context);
        break;
      case 'start_expedition':
        await startExpedition(
          {
            userId,
            stationId: intent.stationId,
            sectorX: intent.sectorX,
            sectorY: intent.sectorY,
          },
          context
        );
        break;
      case 'start_colonization':
        await startColonization(
          {
            userId,
            stationId: intent.stationId,
            sectorX: intent.sectorX,
            sectorY: intent.sectorY,
            name: intent.name,
          },
          context
        );
        break;
      case 'upgrade_defense':
        await startDefenseUpgrade(intent.stationId, intent.upgradeKey, userId, context);
        break;
      case 'start_attack':
        await startAttack({
          userId,
          stationId: intent.stationId,
          targetStationId: intent.targetStationId,
          fleet: intent.fleet,
          context,
        });
        break;
      case 'start_salvage':
        await startSalvage(
          {
            userId,
            stationId: intent.stationId,
            debrisFieldId: intent.debrisFieldId,
            spacecraftKey: intent.spacecraftKey,
            amount: intent.amount,
          },
          context
        );
        break;
    }
  } catch (error) {
    if (error instanceof BotIntentRejected) throw error;
    if (error instanceof AppError) throw classifyDomainError(error);
    throw error;
  }
}
