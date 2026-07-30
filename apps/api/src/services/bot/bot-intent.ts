import type { BuildingKey, DefenseUpgradeKey } from '@orions-frontier/shared';
import { AppError } from '@orions-frontier/shared';
import { createAsteroidAssignment } from '../mining/assignment.service.js';
import { buildSpacecrafts } from '../spacecraft.service.js';
import { startBuildingUpgrade } from '../building.service.js';
import { startResearch } from '../research.service.js';
import { startExpedition, startColonization } from '../world-mission.service.js';
import { startDefenseUpgrade } from '../defense.service.js';
import { startAttack } from '../combat.service.js';
import { startSalvage } from '../salvage.service.js';
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
      spacecraftKey: string;
      amount: number;
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
    /already underway|already upgrading|already started|not enough spacecraft|no (miner|spacecraft) is available/i.test(
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
      case 'assign_miner': {
        const result = await createAsteroidAssignment(
          {
            userId,
            stationId: intent.stationId,
            asteroidId: intent.asteroidId,
            spacecraftKey: intent.spacecraftKey,
            assignedAmount: intent.amount,
          },
          context
        );
        if ('code' in result) {
          const kind = result.code === 'INSUFFICIENT_SPACECRAFT' ? 'waiting' : 'blocked';
          throw new BotIntentRejected(kind, result.message);
        }
        break;
      }
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
        await startResearch(intent.stationId, userId, intent.technologyKey, context);
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
          spacecraftKey: intent.spacecraftKey,
          amount: intent.amount,
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
