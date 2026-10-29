import type { BotDecisionOutcome, ConflictOpportunitySnapshot } from '../../services/bot/index.js';
import type { WorldTickResult } from '../../services/simulation/index.js';
import type { PlaytestCompletionEvent } from '../../lib/completion-events.js';
import type { PlaytestAliasRegistry } from './aliases.js';

type PlaytestDetailValue = string | number | boolean | null;
export interface NormalizedBotDecision {
  kind: 'bot_decision';
  botAlias: string;
  decidedAt: string;
  strategy: string;
  profile: string;
  activeGoalBefore: string | null;
  activeGoalTargetBefore: string | null;
  activeGoalAfter: string | null;
  activeGoalTargetAfter: string | null;
  completedGoalType: string | null;
  action: string;
  resultKind: string;
  normalizedReason: string;
  hasProgress: boolean;
  conflictOpportunity: ConflictOpportunitySnapshot | null;
}

export interface NormalizedCompletionEvent {
  kind: 'completion';
  type: PlaytestCompletionEvent['type'];
  eventAlias: string;
  occurredAt: string;
  userAlias: string;
  stationAlias: string;
  details: Record<string, PlaytestDetailValue>;
}

export interface NormalizedStateObservation {
  kind: 'state_snapshot';
  botAlias: string;
  capturedAt: string;
  progressFingerprint: string;
}

export type PlaytestDiagnostic =
  NormalizedBotDecision | NormalizedCompletionEvent | NormalizedStateObservation;

export interface PlaytestCollectorSummary {
  completionEvents: number;
  duplicateCompletionEvents: number;
  botDecisions: number;
  snapshots: number;
  eventCounts: Record<string, number>;
  actionCounts: Record<string, number>;
  resultCounts: Record<string, number>;
}

export interface CollectorSnapshot {
  capturedAt: string;
  bots: { botAlias: string; progressFingerprint: string }[];
  stations: { stationAlias: string; progressFingerprint: string }[];
}

function normalizeGoalTarget(
  targetRef: string | null,
  aliases: PlaytestAliasRegistry
): string | null {
  if (!targetRef) return null;
  const [kind, first, ...rest] = targetRef.split(':');
  if (!kind || !first) return targetRef;
  switch (kind) {
    case 'station':
      return `station:${aliases.station(first)}${rest.length > 0 ? `:${rest.join(':')}` : ''}`;
    case 'tech':
      return `tech:${aliases.station(first)}${rest.length > 0 ? `:${rest.join(':')}` : ''}`;
    case 'user':
      return `user:${aliases.user(first)}${rest.length > 0 ? `:${rest.join(':')}` : ''}`;
    case 'debris':
      return `debris:${aliases.entity('debris', first)}${rest.length > 0 ? `:${rest.join(':')}` : ''}`;
    default:
      return targetRef;
  }
}

function normalizeDecision(
  decision: BotDecisionOutcome,
  aliases: PlaytestAliasRegistry
): NormalizedBotDecision {
  return {
    kind: 'bot_decision',
    botAlias: aliases.user(decision.botUserId),
    decidedAt: decision.decidedAt.toISOString(),
    strategy: decision.strategy,
    profile: decision.profile,
    activeGoalBefore: decision.activeGoalBefore,
    activeGoalTargetBefore: normalizeGoalTarget(decision.activeGoalTargetBefore, aliases),
    activeGoalAfter: decision.activeGoalAfter,
    activeGoalTargetAfter: normalizeGoalTarget(decision.activeGoalTargetAfter, aliases),
    completedGoalType: decision.completedGoalType,
    action: decision.action,
    resultKind: decision.resultKind,
    normalizedReason: decision.normalizedReason,
    hasProgress: decision.hasProgress,
    conflictOpportunity: decision.conflictOpportunity ? { ...decision.conflictOpportunity } : null,
  };
}

function normalizeCompletion(
  event: PlaytestCompletionEvent,
  aliases: PlaytestAliasRegistry
): NormalizedCompletionEvent {
  const details: Record<string, PlaytestDetailValue> = {};
  switch (event.type) {
    case 'mining_delivery_completed':
      Object.assign(details, {
        tripAlias: aliases.entity('trip', event.tripId),
        asteroidAlias: event.asteroidId ? aliases.entity('asteroid', event.asteroidId) : null,
        requested: event.requested,
        credited: event.credited,
        discarded: event.discarded,
        targetVisibilityVerified: event.targetVisibilityVerified,
        asteroidExhausted: event.asteroidExhausted,
      });
      break;
    case 'building_completed':
      Object.assign(details, { buildingKey: event.buildingKey, newLevel: event.newLevel });
      break;
    case 'defense_completed':
      Object.assign(details, { defenseKey: event.defenseKey, newLevel: event.newLevel });
      break;
    case 'spacecraft_completed':
      Object.assign(details, {
        orderAlias: aliases.entity('order', event.orderId),
        spacecraftKey: event.spacecraftKey,
        amount: event.amount,
      });
      break;
    case 'research_completed':
      Object.assign(details, {
        researchAlias: aliases.entity('research', event.researchId),
        technologyKey: event.technologyKey,
      });
      break;
    case 'world_mission_completed':
      Object.assign(details, {
        missionAlias: aliases.entity('mission', event.missionId),
        missionType: event.missionType,
        stage: event.stage,
      });
      break;
    case 'colony_established':
      Object.assign(details, {
        missionAlias: aliases.entity('mission', event.missionId),
        colonyStationAlias: aliases.registerStation(event.userId, event.colonyStationId),
        sectorX: event.sectorX,
        sectorY: event.sectorY,
      });
      break;
    case 'combat_resolved':
      Object.assign(details, {
        missionAlias: aliases.entity('mission', event.missionId),
        defenderStationAlias: aliases.station(event.defenderStationId),
        winner: event.winner,
        attackerLosses: event.attackerLosses,
        defenderLosses: event.defenderLosses,
        targetVisibilityVerified: event.targetVisibilityVerified,
      });
      break;
    case 'loot_acquired':
      Object.assign(details, {
        missionAlias: aliases.entity('mission', event.missionId),
        resources: event.resources,
      });
      break;
    case 'loot_delivered':
    case 'salvage_completed':
      Object.assign(details, {
        missionAlias: aliases.entity('mission', event.missionId),
        requested: event.requested,
        credited: event.credited,
        discarded: event.discarded,
        ...('targetVisibilityVerified' in event
          ? { targetVisibilityVerified: event.targetVisibilityVerified }
          : {}),
      });
      break;
    case 'fleet_losses':
      Object.assign(details, {
        missionAlias: aliases.entity('mission', event.missionId),
        attackerLosses: event.attackerLosses,
        defenderLosses: event.defenderLosses,
      });
      break;
    case 'debris_created':
      Object.assign(details, {
        missionAlias: aliases.entity('mission', event.missionId),
        debrisAlias: aliases.entity('debris', event.debrisId),
        resources: event.resources,
      });
      break;
  }
  return {
    kind: 'completion',
    type: event.type,
    eventAlias: aliases.entity('completion', event.eventId),
    occurredAt: event.occurredAt.toISOString(),
    userAlias: aliases.user(event.userId),
    stationAlias: aliases.station(event.stationId),
    details,
  };
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function sortedRecord(counts: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
  );
}

export class PlaytestCollector {
  private readonly seenEventIds = new Set<string>();
  private readonly diagnosticsByBot = new Map<string, PlaytestDiagnostic[]>();
  private readonly snapshotsByBot = new Map<string, NormalizedStateObservation[]>();
  private readonly eventCounts = new Map<string, number>();
  private readonly actionCounts = new Map<string, number>();
  private readonly resultCounts = new Map<string, number>();
  private completionEvents = 0;
  private duplicateCompletionEvents = 0;
  private botDecisions = 0;
  private snapshots = 0;
  private latestSnapshot: CollectorSnapshot | null = null;

  constructor(
    readonly aliases: PlaytestAliasRegistry,
    private readonly diagnosticWindowSize = 50
  ) {
    if (!Number.isInteger(diagnosticWindowSize) || diagnosticWindowSize < 1) {
      throw new Error('Collector diagnostic window size must be a positive integer');
    }
  }

  private remember(botAlias: string, diagnostic: PlaytestDiagnostic): void {
    const window = this.diagnosticsByBot.get(botAlias) ?? [];
    window.push(diagnostic);
    if (window.length > this.diagnosticWindowSize) {
      window.splice(0, window.length - this.diagnosticWindowSize);
    }
    this.diagnosticsByBot.set(botAlias, window);
  }

  consumeBotDecision(decision: BotDecisionOutcome): NormalizedBotDecision {
    const normalized = normalizeDecision(decision, this.aliases);
    this.botDecisions += 1;
    increment(this.actionCounts, normalized.action);
    increment(this.resultCounts, normalized.resultKind);
    this.remember(normalized.botAlias, normalized);
    return normalized;
  }

  consumeCompletion(event: PlaytestCompletionEvent): NormalizedCompletionEvent | null {
    if (this.seenEventIds.has(event.eventId)) {
      this.duplicateCompletionEvents += 1;
      return null;
    }
    this.seenEventIds.add(event.eventId);
    const normalized = normalizeCompletion(event, this.aliases);
    this.completionEvents += 1;
    increment(this.eventCounts, normalized.type);
    this.remember(normalized.userAlias, normalized);
    return normalized;
  }

  consumeWorldTick(result: WorldTickResult): void {
    for (const event of result.events) this.consumeCompletion(event);
    for (const decision of result.botDecisions) this.consumeBotDecision(decision);
  }

  consumeSnapshot(snapshot: CollectorSnapshot): void {
    this.snapshots += 1;
    this.latestSnapshot = structuredClone(snapshot);
    for (const bot of snapshot.bots) {
      const observations = this.snapshotsByBot.get(bot.botAlias) ?? [];
      observations.push({
        kind: 'state_snapshot',
        botAlias: bot.botAlias,
        capturedAt: snapshot.capturedAt,
        progressFingerprint: bot.progressFingerprint,
      });
      if (observations.length > this.diagnosticWindowSize) {
        observations.splice(0, observations.length - this.diagnosticWindowSize);
      }
      this.snapshotsByBot.set(bot.botAlias, observations);
    }
  }

  diagnostics(botAlias: string): PlaytestDiagnostic[] {
    return structuredClone([
      ...(this.diagnosticsByBot.get(botAlias) ?? []),
      ...(this.snapshotsByBot.get(botAlias) ?? []),
    ]).sort((left, right) => {
      const leftTime =
        left.kind === 'bot_decision'
          ? left.decidedAt
          : left.kind === 'state_snapshot'
            ? left.capturedAt
            : left.occurredAt;
      const rightTime =
        right.kind === 'bot_decision'
          ? right.decidedAt
          : right.kind === 'state_snapshot'
            ? right.capturedAt
            : right.occurredAt;
      return leftTime.localeCompare(rightTime);
    });
  }

  lastSnapshot(): CollectorSnapshot | null {
    return this.latestSnapshot ? structuredClone(this.latestSnapshot) : null;
  }

  summary(): PlaytestCollectorSummary {
    return {
      completionEvents: this.completionEvents,
      duplicateCompletionEvents: this.duplicateCompletionEvents,
      botDecisions: this.botDecisions,
      snapshots: this.snapshots,
      eventCounts: sortedRecord(this.eventCounts),
      actionCounts: sortedRecord(this.actionCounts),
      resultCounts: sortedRecord(this.resultCounts),
    };
  }
}
