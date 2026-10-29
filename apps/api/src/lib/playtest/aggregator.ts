import { entriesOf, resourceKeys, type ResourceMap } from '@orions-frontier/shared';
import type { BotDecisionOutcome } from '../../services/bot/bot.service.js';
import { BOT_RESOURCE_PREFERENCE_WEIGHTS } from '../../services/bot/goal-economy.js';
import type { WorldTickResult } from '../../services/simulation.service.js';
import type { PlaytestCompletionEvent } from '../completion-events.js';
import type { PlaytestAliasRegistry } from './aliases.js';
import { milestoneKeys, recordMilestone } from './milestones.js';
import {
  addResources,
  emptyConflictMetrics,
  emptyDevelopmentMetrics,
  emptyEconomyMetrics,
  emptyExpansionMetrics,
  emptyGoalMetrics,
  emptySalvageMetrics,
  safeRatio,
  snapshotWorld,
  sortedResources,
  type AggregateMetrics,
  type BotMetrics,
  type GoalMetrics,
  type PlaytestMetrics,
  type ProfileMetrics,
} from './metrics.js';
import type { PlaytestPopulationMember } from './population.js';
import type { PlaytestStateSnapshot } from './snapshot-loader.js';

interface BotAggregationState {
  metrics: BotMetrics;
  currentGoal: string | null;
  bindingStartedAt: number | null;
  lastDecisionAt: number | null;
  colonyFoundedAt: Map<string, number>;
  colonyStableAt: Map<string, number>;
}

interface StationSampleState {
  ownerAlias: string;
  capturedAt: number;
  wasFull: boolean;
}

function createBot(
  botAlias: string,
  profile: string,
  populationKind: string,
  joinedAt: string
): BotAggregationState {
  return {
    metrics: {
      botAlias,
      profile,
      populationKind,
      joinedAt,
      goals: {},
      milestones: {},
      economy: emptyEconomyMetrics(),
      development: emptyDevelopmentMetrics(),
      expansion: emptyExpansionMetrics(),
      conflict: emptyConflictMetrics(),
      salvage: emptySalvageMetrics(),
    },
    currentGoal: null,
    bindingStartedAt: null,
    lastDecisionAt: null,
    colonyFoundedAt: new Map(),
    colonyStableAt: new Map(),
  };
}

function recordColonyStabilization(
  state: BotAggregationState,
  stationAlias: string,
  observedStableAt: number
): void {
  const stableAt = Math.min(
    state.colonyStableAt.get(stationAlias) ?? observedStableAt,
    observedStableAt
  );
  state.colonyStableAt.set(stationAlias, stableAt);

  const foundedAt = state.colonyFoundedAt.get(stationAlias);
  if (foundedAt === undefined) return;

  const duration = Math.max(0, stableAt - foundedAt);
  const expansion = state.metrics.expansion;
  expansion.colonyStabilizationDurationMs =
    expansion.colonyStabilizationDurationMs === null
      ? duration
      : Math.min(expansion.colonyStabilizationDurationMs, duration);
  const colonyMetrics = expansion.coloniesByStation[stationAlias];
  if (colonyMetrics?.stabilizationDurationMs === null) {
    colonyMetrics.stabilizationDurationMs = duration;
  }
  recordMilestone(state.metrics.milestones, 'stableColony', new Date(stableAt));
}

function goal(metrics: BotMetrics, goalType: string): GoalMetrics {
  return (metrics.goals[goalType] ??= emptyGoalMetrics());
}

function weighted(resources: ResourceMap): number {
  return entriesOf(resources).reduce(
    (sum, [resourceKey, amount]) => sum + amount * BOT_RESOURCE_PREFERENCE_WEIGHTS[resourceKey],
    0
  );
}

function sumRecord(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function emptyAggregate(): AggregateMetrics {
  return {
    bots: 0,
    goals: {},
    milestonesReached: {},
    economy: emptyEconomyMetrics(),
    development: emptyDevelopmentMetrics(),
    expansion: emptyExpansionMetrics(),
    conflict: emptyConflictMetrics(),
    salvage: emptySalvageMetrics(),
  };
}

function addGoal(target: GoalMetrics, source: GoalMetrics): void {
  target.selections += source.selections;
  target.activeDurationMs += source.activeDurationMs;
  target.switches += source.switches;
  target.completions += source.completions;
  target.success += source.success;
  target.failed += source.failed;
  target.waiting += source.waiting;
  target.saving += source.saving;
  target.blocked += source.blocked;
  target.maximumBindingDurationMs = Math.max(
    target.maximumBindingDurationMs,
    source.maximumBindingDurationMs
  );
}

function aggregateBots(bots: readonly BotMetrics[]): AggregateMetrics {
  const aggregate = emptyAggregate();
  aggregate.bots = bots.length;
  let minimumInitialized = false;
  for (const bot of bots) {
    for (const [goalType, source] of Object.entries(bot.goals)) {
      addGoal((aggregate.goals[goalType] ??= emptyGoalMetrics()), source);
    }
    for (const milestone of milestoneKeys) {
      if (bot.milestones[milestone]) {
        aggregate.milestonesReached[milestone] = (aggregate.milestonesReached[milestone] ?? 0) + 1;
      }
    }
    addResources(aggregate.economy.minedResources, bot.economy.minedResources);
    addResources(aggregate.economy.deliveredResources, bot.economy.deliveredResources);
    addResources(aggregate.economy.discardedResources, bot.economy.discardedResources);
    aggregate.economy.weightedDeliveredUnits += bot.economy.weightedDeliveredUnits;
    for (const resourceKey of resourceKeys) {
      const current = bot.economy.minimumResources[resourceKey] ?? 0;
      aggregate.economy.minimumResources[resourceKey] = minimumInitialized
        ? Math.min(aggregate.economy.minimumResources[resourceKey] ?? current, current)
        : current;
    }
    minimumInitialized = true;
    aggregate.economy.fullStorageDurationMs += bot.economy.fullStorageDurationMs;
    sumRecord(
      aggregate.economy.fullStorageDurationByStationMs,
      bot.economy.fullStorageDurationByStationMs
    );
    aggregate.economy.exhaustedAsteroids += bot.economy.exhaustedAsteroids;
    aggregate.economy.unreachableResourceNeeds += bot.economy.unreachableResourceNeeds;

    aggregate.development.buildingLevelTotal += bot.development.buildingLevelTotal;
    aggregate.development.defenseLevelTotal += bot.development.defenseLevelTotal;
    aggregate.development.completedResearch += bot.development.completedResearch;
    aggregate.development.influence += bot.development.influence;
    aggregate.development.spacecraftUnits += bot.development.spacecraftUnits;
    sumRecord(aggregate.development.spacecraftBuilt, bot.development.spacecraftBuilt);
    aggregate.development.queueActiveSamples += bot.development.queueActiveSamples;
    aggregate.development.snapshotSamples += bot.development.snapshotSamples;

    aggregate.expansion.expeditions += bot.expansion.expeditions;
    aggregate.expansion.discoveredSectors += bot.expansion.discoveredSectors;
    aggregate.expansion.colonies += bot.expansion.colonies;
    aggregate.expansion.stations += bot.expansion.stations;
    Object.assign(
      aggregate.expansion.coloniesByStation,
      structuredClone(bot.expansion.coloniesByStation)
    );
    if (bot.expansion.colonyStabilizationDurationMs !== null) {
      aggregate.expansion.colonyStabilizationDurationMs =
        aggregate.expansion.colonyStabilizationDurationMs === null
          ? bot.expansion.colonyStabilizationDurationMs
          : Math.min(
              aggregate.expansion.colonyStabilizationDurationMs,
              bot.expansion.colonyStabilizationDurationMs
            );
    }

    aggregate.conflict.attacks += bot.conflict.attacks;
    aggregate.conflict.retaliations += bot.conflict.retaliations;
    aggregate.conflict.protectionRejections += bot.conflict.protectionRejections;
    aggregate.conflict.wins += bot.conflict.wins;
    aggregate.conflict.losses += bot.conflict.losses;
    aggregate.conflict.attackerLosses += bot.conflict.attackerLosses;
    aggregate.conflict.defenderLosses += bot.conflict.defenderLosses;
    addResources(aggregate.conflict.loot, bot.conflict.loot);
    sumRecord(aggregate.conflict.targets, bot.conflict.targets);
    aggregate.conflict.maximumObservedReserve = Math.max(
      aggregate.conflict.maximumObservedReserve,
      bot.conflict.maximumObservedReserve
    );
    aggregate.conflict.opportunitySamples += bot.conflict.opportunitySamples;
    aggregate.conflict.visibleTargets += bot.conflict.visibleTargets;
    aggregate.conflict.eligibleAfterProtectionAndCooldown +=
      bot.conflict.eligibleAfterProtectionAndCooldown;
    aggregate.conflict.sufficientFleetAndReserve += bot.conflict.sufficientFleetAndReserve;
    aggregate.conflict.viableTargets += bot.conflict.viableTargets;
    sumRecord(aggregate.conflict.opportunityStages, bot.conflict.opportunityStages);

    addResources(aggregate.salvage.debrisCreatedResources, bot.salvage.debrisCreatedResources);
    addResources(aggregate.salvage.salvagedResources, bot.salvage.salvagedResources);
    aggregate.salvage.missions += bot.salvage.missions;
    aggregate.salvage.collectorBuilds += bot.salvage.collectorBuilds;
  }
  aggregate.development.queueUtilization = safeRatio(
    aggregate.development.queueActiveSamples,
    aggregate.development.snapshotSamples
  );
  return aggregate;
}

function normalizeAggregate(aggregate: AggregateMetrics): AggregateMetrics {
  for (const goalMetrics of Object.values(aggregate.goals)) {
    for (const [key, value] of entriesOf(goalMetrics)) {
      if (!Number.isFinite(value)) goalMetrics[key] = 0;
    }
  }
  aggregate.economy.minedResources = sortedResources(aggregate.economy.minedResources);
  aggregate.economy.deliveredResources = sortedResources(aggregate.economy.deliveredResources);
  aggregate.economy.discardedResources = sortedResources(aggregate.economy.discardedResources);
  aggregate.economy.minimumResources = sortedResources(aggregate.economy.minimumResources);
  aggregate.economy.fullStorageDurationByStationMs = Object.fromEntries(
    Object.entries(aggregate.economy.fullStorageDurationByStationMs).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
  aggregate.conflict.loot = sortedResources(aggregate.conflict.loot);
  aggregate.salvage.debrisCreatedResources = sortedResources(
    aggregate.salvage.debrisCreatedResources
  );
  aggregate.salvage.salvagedResources = sortedResources(aggregate.salvage.salvagedResources);
  aggregate.salvage.remainingDebrisResources = sortedResources(
    aggregate.salvage.remainingDebrisResources
  );
  aggregate.goals = Object.fromEntries(
    Object.entries(aggregate.goals).sort(([left], [right]) => left.localeCompare(right))
  );
  aggregate.milestonesReached = Object.fromEntries(
    Object.entries(aggregate.milestonesReached).sort(([left], [right]) => left.localeCompare(right))
  );
  aggregate.development.spacecraftBuilt = Object.fromEntries(
    Object.entries(aggregate.development.spacecraftBuilt).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
  aggregate.conflict.targets = Object.fromEntries(
    Object.entries(aggregate.conflict.targets).sort(([left], [right]) => left.localeCompare(right))
  );
  aggregate.conflict.opportunityStages = Object.fromEntries(
    Object.entries(aggregate.conflict.opportunityStages).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
  aggregate.expansion.coloniesByStation = Object.fromEntries(
    Object.entries(aggregate.expansion.coloniesByStation).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
  return aggregate;
}

export class PlaytestAggregator {
  private readonly bots = new Map<string, BotAggregationState>();
  private readonly stationSamples = new Map<string, StationSampleState>();
  private readonly exhaustedAsteroids = new Set<string>();
  private latestSnapshot: PlaytestStateSnapshot | null = null;
  private finalizedAt: number | null = null;

  constructor(private readonly aliases: PlaytestAliasRegistry) {}

  registerPopulationMember(member: PlaytestPopulationMember): void {
    const existing = this.bots.get(member.alias);
    if (existing) return;
    this.bots.set(
      member.alias,
      createBot(member.alias, member.profile, member.populationKind, member.joinedAt.toISOString())
    );
  }

  private bot(userId: string, profile = 'unknown', at = new Date()): BotAggregationState {
    const alias = this.aliases.user(userId);
    let state = this.bots.get(alias);
    if (!state) {
      state = createBot(alias, profile, 'unknown', at.toISOString());
      this.bots.set(alias, state);
    } else if (state.metrics.profile === 'unknown' && profile !== 'unknown') {
      state.metrics.profile = profile;
    }
    return state;
  }

  consumeDecision(decision: BotDecisionOutcome): void {
    const state = this.bot(decision.botUserId, decision.profile, decision.decidedAt);
    const now = decision.decidedAt.getTime();
    if (state.currentGoal && state.lastDecisionAt !== null) {
      goal(state.metrics, state.currentGoal).activeDurationMs += Math.max(
        0,
        now - state.lastDecisionAt
      );
    }

    const before = decision.activeGoalBefore;
    const after = decision.activeGoalAfter;
    const completedGoalType =
      decision.completedGoalType ??
      (before && !after && decision.resultKind === 'complete' ? before : null);
    if (completedGoalType) {
      goal(state.metrics, completedGoalType).completions += 1;
    }
    if (after && after !== before) {
      const selected = goal(state.metrics, after);
      selected.selections += 1;
      if (before && completedGoalType !== before) selected.switches += 1;
      if (state.bindingStartedAt !== null && state.currentGoal) {
        const duration = Math.max(0, now - state.bindingStartedAt);
        const previous = goal(state.metrics, state.currentGoal);
        previous.maximumBindingDurationMs = Math.max(previous.maximumBindingDurationMs, duration);
      }
      state.bindingStartedAt = now;
    } else if (after && state.bindingStartedAt === null) {
      state.bindingStartedAt = now;
    }
    const attributedGoal = after ?? before ?? 'none';
    const result = goal(state.metrics, attributedGoal);
    if (decision.resultKind === 'success') result.success += 1;
    else if (decision.resultKind === 'failed') result.failed += 1;
    else if (decision.resultKind === 'waiting') result.waiting += 1;
    else if (decision.resultKind === 'saving') result.saving += 1;
    else if (decision.resultKind === 'blocked') result.blocked += 1;
    if (before && !after && state.bindingStartedAt !== null) {
      result.maximumBindingDurationMs = Math.max(
        result.maximumBindingDurationMs,
        now - state.bindingStartedAt
      );
      state.bindingStartedAt = null;
    }
    if (
      (decision.resultKind === 'blocked' || decision.resultKind === 'saving') &&
      /insufficient|saving resources|cannot afford|no mineable|resource/i.test(
        decision.normalizedReason
      )
    ) {
      state.metrics.economy.unreachableResourceNeeds += 1;
    }
    if (/protected from attacks/i.test(decision.normalizedReason)) {
      state.metrics.conflict.protectionRejections += 1;
    }
    if (decision.conflictOpportunity) {
      const opportunity = decision.conflictOpportunity;
      state.metrics.conflict.opportunitySamples += 1;
      state.metrics.conflict.visibleTargets += opportunity.visibleTargets;
      state.metrics.conflict.eligibleAfterProtectionAndCooldown +=
        opportunity.eligibleAfterProtectionAndCooldown;
      state.metrics.conflict.sufficientFleetAndReserve += opportunity.sufficientFleetAndReserve;
      state.metrics.conflict.viableTargets += opportunity.viableTargets;
      state.metrics.conflict.opportunityStages[opportunity.lastExclusionStage] =
        (state.metrics.conflict.opportunityStages[opportunity.lastExclusionStage] ?? 0) + 1;
    }
    if (decision.resultKind === 'success' && (before === 'retaliate' || after === 'retaliate')) {
      state.metrics.conflict.retaliations += 1;
      recordMilestone(state.metrics.milestones, 'firstRetaliation', decision.decidedAt);
    }
    state.currentGoal = after;
    state.lastDecisionAt = now;
  }

  consumeCompletion(event: PlaytestCompletionEvent): void {
    const state = this.bot(event.userId, 'unknown', event.occurredAt);
    const metrics = state.metrics;
    switch (event.type) {
      case 'mining_delivery_completed': {
        addResources(metrics.economy.minedResources, event.requested);
        addResources(metrics.economy.deliveredResources, event.credited);
        addResources(metrics.economy.discardedResources, event.discarded);
        metrics.economy.weightedDeliveredUnits += weighted(event.credited);
        recordMilestone(metrics.milestones, 'firstMining', event.occurredAt);
        if (event.asteroidExhausted && event.asteroidId) {
          const alias = this.aliases.entity('asteroid', event.asteroidId);
          if (!this.exhaustedAsteroids.has(alias)) {
            this.exhaustedAsteroids.add(alias);
            metrics.economy.exhaustedAsteroids += 1;
          }
        }
        break;
      }
      case 'spacecraft_completed':
        metrics.development.spacecraftBuilt[event.spacecraftKey] =
          (metrics.development.spacecraftBuilt[event.spacecraftKey] ?? 0) + event.amount;
        if (event.spacecraftKey === 'collector') metrics.salvage.collectorBuilds += event.amount;
        break;
      case 'research_completed':
        recordMilestone(metrics.milestones, 'firstResearch', event.occurredAt);
        break;
      case 'defense_completed':
        recordMilestone(metrics.milestones, 'firstDefense', event.occurredAt);
        break;
      case 'world_mission_completed':
        if (event.missionType === 'expedition' && event.stage === 'target_reached') {
          metrics.expansion.expeditions += 1;
          metrics.expansion.discoveredSectors += 1;
          recordMilestone(metrics.milestones, 'firstExpedition', event.occurredAt);
        }
        break;
      case 'colony_established': {
        metrics.expansion.colonies += 1;
        const colonyAlias = this.aliases.registerStation(event.userId, event.colonyStationId);
        state.colonyFoundedAt.set(colonyAlias, event.occurredAt.getTime());
        metrics.expansion.coloniesByStation[colonyAlias] = {
          foundedAt: event.occurredAt.toISOString(),
          stabilizationDurationMs: null,
        };
        recordMilestone(metrics.milestones, 'firstColony', event.occurredAt);
        const stableAt = state.colonyStableAt.get(colonyAlias);
        if (stableAt !== undefined) {
          recordColonyStabilization(state, colonyAlias, stableAt);
        }
        break;
      }
      case 'combat_resolved':
        metrics.conflict.attacks += 1;
        if (event.winner === 'attacker') metrics.conflict.wins += 1;
        else metrics.conflict.losses += 1;
        {
          const target = this.aliases.station(event.defenderStationId);
          metrics.conflict.targets[target] = (metrics.conflict.targets[target] ?? 0) + 1;
        }
        recordMilestone(metrics.milestones, 'firstAttack', event.occurredAt);
        break;
      case 'fleet_losses':
        metrics.conflict.attackerLosses += event.attackerLosses;
        metrics.conflict.defenderLosses += event.defenderLosses;
        break;
      case 'loot_acquired':
        addResources(metrics.conflict.loot, event.resources);
        break;
      case 'debris_created':
        addResources(metrics.salvage.debrisCreatedResources, event.resources);
        break;
      case 'salvage_completed':
        metrics.salvage.missions += 1;
        addResources(metrics.salvage.salvagedResources, event.credited);
        recordMilestone(metrics.milestones, 'firstSalvage', event.occurredAt);
        break;
      default:
        break;
    }
  }

  consumeWorldTick(tick: WorldTickResult): void {
    if (this.finalizedAt !== null) throw new Error('Cannot aggregate after finalization');
    for (const event of tick.events) this.consumeCompletion(event);
    for (const decision of tick.botDecisions) this.consumeDecision(decision);
  }

  consumeSnapshot(snapshot: PlaytestStateSnapshot): void {
    if (this.finalizedAt !== null) throw new Error('Cannot aggregate after finalization');
    const capturedAt = new Date(snapshot.capturedAt).getTime();
    this.latestSnapshot = structuredClone(snapshot);
    for (const botSnapshot of snapshot.bots) {
      const state =
        this.bots.get(botSnapshot.botAlias) ??
        createBot(
          botSnapshot.botAlias,
          botSnapshot.profile,
          botSnapshot.populationKind,
          snapshot.capturedAt
        );
      this.bots.set(botSnapshot.botAlias, state);
      state.metrics.profile = botSnapshot.profile;
      state.metrics.populationKind = botSnapshot.populationKind;
      state.metrics.development.buildingLevelTotal = snapshot.stations
        .filter((station) => station.ownerAlias === botSnapshot.botAlias)
        .reduce((sum, station) => sum + station.buildingLevelTotal, 0);
      state.metrics.development.defenseLevelTotal = snapshot.stations
        .filter((station) => station.ownerAlias === botSnapshot.botAlias)
        .reduce((sum, station) => sum + station.defenseLevelTotal, 0);
      state.metrics.development.completedResearch = botSnapshot.completedResearch;
      state.metrics.development.influence = botSnapshot.influence;
      state.metrics.development.spacecraftUnits = botSnapshot.spacecraftUnits;
      state.metrics.development.snapshotSamples += 1;
      const ownedStations = snapshot.stations.filter(
        (station) => station.ownerAlias === botSnapshot.botAlias
      );
      if (ownedStations.some((station) => station.activeBuildOrders > 0)) {
        state.metrics.development.queueActiveSamples += 1;
      }
      state.metrics.development.queueUtilization = safeRatio(
        state.metrics.development.queueActiveSamples,
        state.metrics.development.snapshotSamples
      );
      state.metrics.expansion.stations = botSnapshot.stationCount;
      state.metrics.conflict.maximumObservedReserve = Math.max(
        state.metrics.conflict.maximumObservedReserve,
        botSnapshot.spacecraftUnits - botSnapshot.lockedSpacecraftUnits
      );
      if (
        ownedStations.some(
          (station) =>
            station.stationAlias.endsWith('/station-001') &&
            station.resourceUnits > 0 &&
            station.spacecraftUnits > 0
        )
      ) {
        recordMilestone(state.metrics.milestones, 'stableInitialStation', snapshot.capturedAt);
      }
      const spacecraftByKey: Record<string, number> = {};
      for (const station of ownedStations) {
        sumRecord(spacecraftByKey, station.spacecraftByKey);
      }
      if ((spacecraftByKey['mole'] ?? 0) >= 3 && (spacecraftByKey['titan'] ?? 0) >= 1) {
        recordMilestone(state.metrics.milestones, 'threeMolesAndTitan', snapshot.capturedAt);
      }
      for (const station of ownedStations) {
        for (const resourceKey of resourceKeys) {
          const amount = station.resources[resourceKey] ?? 0;
          const current = state.metrics.economy.minimumResources[resourceKey];
          state.metrics.economy.minimumResources[resourceKey] =
            current === undefined ? amount : Math.min(current, amount);
        }
        const previous = this.stationSamples.get(station.stationAlias);
        if (previous?.wasFull) {
          const duration = Math.max(0, capturedAt - previous.capturedAt);
          state.metrics.economy.fullStorageDurationMs += duration;
          state.metrics.economy.fullStorageDurationByStationMs[station.stationAlias] =
            (state.metrics.economy.fullStorageDurationByStationMs[station.stationAlias] ?? 0) +
            duration;
        }
        const isFull =
          station.storageCapacityPerResource > 0 &&
          Object.values(station.resources).some(
            (amount) => amount >= station.storageCapacityPerResource
          );
        this.stationSamples.set(station.stationAlias, {
          ownerAlias: station.ownerAlias,
          capturedAt,
          wasFull: isFull,
        });
        if (station.resourceUnits > 0 && station.spacecraftUnits > 0) {
          recordColonyStabilization(state, station.stationAlias, capturedAt);
        }
      }
    }
  }

  finalize(virtualEnd: Date): PlaytestMetrics {
    const end = virtualEnd.getTime();
    if (this.finalizedAt === null) {
      for (const state of this.bots.values()) {
        if (state.currentGoal && state.lastDecisionAt !== null) {
          const current = goal(state.metrics, state.currentGoal);
          current.activeDurationMs += Math.max(0, end - state.lastDecisionAt);
          if (state.bindingStartedAt !== null) {
            current.maximumBindingDurationMs = Math.max(
              current.maximumBindingDurationMs,
              end - state.bindingStartedAt
            );
          }
        }
      }
      this.finalizedAt = end;
    } else if (this.finalizedAt !== end) {
      throw new Error('Playtest metrics were already finalized at a different time');
    }

    const bots = [...this.bots.values()]
      .map((state) => structuredClone(state.metrics))
      .sort((left, right) => left.botAlias.localeCompare(right.botAlias));
    for (const bot of bots) {
      bot.goals = Object.fromEntries(
        Object.entries(bot.goals).sort(([left], [right]) => left.localeCompare(right))
      );
      bot.economy.minedResources = sortedResources(bot.economy.minedResources);
      bot.economy.deliveredResources = sortedResources(bot.economy.deliveredResources);
      bot.economy.discardedResources = sortedResources(bot.economy.discardedResources);
      bot.economy.minimumResources = sortedResources(bot.economy.minimumResources);
      bot.economy.fullStorageDurationByStationMs = Object.fromEntries(
        Object.entries(bot.economy.fullStorageDurationByStationMs).sort(([left], [right]) =>
          left.localeCompare(right)
        )
      );
      bot.conflict.loot = sortedResources(bot.conflict.loot);
      bot.expansion.coloniesByStation = Object.fromEntries(
        Object.entries(bot.expansion.coloniesByStation).sort(([left], [right]) =>
          left.localeCompare(right)
        )
      );
      bot.conflict.opportunityStages = Object.fromEntries(
        Object.entries(bot.conflict.opportunityStages).sort(([left], [right]) =>
          left.localeCompare(right)
        )
      );
      bot.salvage.debrisCreatedResources = sortedResources(bot.salvage.debrisCreatedResources);
      bot.salvage.salvagedResources = sortedResources(bot.salvage.salvagedResources);
    }
    const profileNames = [...new Set(bots.map((bot) => bot.profile))].sort();
    const profiles: ProfileMetrics[] = profileNames.map((profile) => ({
      profile,
      ...normalizeAggregate(aggregateBots(bots.filter((bot) => bot.profile === profile))),
    }));
    const run = normalizeAggregate(aggregateBots(bots));
    const world = snapshotWorld(this.latestSnapshot);
    run.salvage.remainingDebrisResources = sortedResources(world.debrisResources);
    return {
      bots,
      profiles,
      run,
      stations: [...(this.latestSnapshot?.stations ?? [])].sort((left, right) =>
        left.stationAlias.localeCompare(right.stationAlias)
      ),
      world,
      finalSnapshotAt: this.latestSnapshot?.capturedAt ?? null,
    };
  }
}
