import { performance } from 'node:perf_hooks';
import type { GameExecutionContext } from '../../lib/game-execution-context.js';
import { runWorldTick, type WorldTickResult } from '../../services/simulation.service.js';
import { PlaytestAliasRegistry } from './aliases.js';
import { bootstrapPlaytestWorld, type PlaytestBootstrapResult } from './bootstrap.js';
import { PlaytestCollector } from './collector.js';
import type { PlaytestConfig } from './config.js';
import { joinSyntheticPlayer, PlaytestPopulationRegistry } from './population.js';
import { loadPlaytestSnapshot, type PlaytestStateSnapshot } from './snapshot-loader.js';
import { PlaytestInvariantAuditor } from './invariants.js';
import { PlaytestAggregator } from './aggregator.js';
import type { PlaytestMetrics } from './metrics.js';
import { analyzeSoftlocks, type PlaytestWarning } from './softlock-analyzer.js';
import { configuredWarningFixture, injectConfiguredInvariantFault } from './fault-injection.js';

const PROGRESS_INTERVAL_MS = 6 * 60 * 60 * 1_000;

export interface PlaytestProgress {
  now: Date;
  end: Date;
  ticks: number;
  syntheticPlayers: number;
  controlledPopulation: number;
}

export interface PlaytestRunnerHooks {
  afterTick?: (tick: WorldTickResult) => void | Promise<void>;
  afterSnapshot?: (snapshot: PlaytestStateSnapshot) => void | Promise<void>;
  onProgress?: (progress: PlaytestProgress) => void;
}

export interface PlaytestRunResult {
  bootstrap: PlaytestBootstrapResult;
  collector: PlaytestCollector;
  population: PlaytestPopulationRegistry;
  aliases: PlaytestAliasRegistry;
  ticks: number;
  snapshots: number;
  virtualStart: Date;
  virtualEnd: Date;
  realDurationMs: number;
  maximumControlledPopulation: number;
  metrics: PlaytestMetrics;
  warnings: PlaytestWarning[];
}

export class PlaytestRunFailure extends Error {
  constructor(
    readonly cause: unknown,
    readonly partialResult: PlaytestRunResult
  ) {
    super(cause instanceof Error ? cause.message : 'Playtest run failed');
    this.name = 'PlaytestRunFailure';
  }
}

export async function runPlaytest(
  config: PlaytestConfig,
  context: GameExecutionContext,
  hooks: PlaytestRunnerHooks = {}
): Promise<PlaytestRunResult> {
  if (
    context.worldSeed !== config.seed ||
    context.now.getTime() !== config.virtualStart.getTime()
  ) {
    throw new Error('Playtest runner config and execution context must share seed and start time');
  }

  const realStartedAt = performance.now();
  const bootstrap = await bootstrapPlaytestWorld(
    { seed: config.seed, virtualStart: config.virtualStart },
    context
  );
  const population = new PlaytestPopulationRegistry();
  const aliases = new PlaytestAliasRegistry();
  const collector = new PlaytestCollector(aliases, config.diagnosticWindowSize);
  const invariantAuditor = new PlaytestInvariantAuditor(aliases);
  const aggregator = new PlaytestAggregator(aliases);
  const virtualEnd = new Date(config.virtualStart.getTime() + config.durationMs);
  let now = new Date(config.virtualStart);
  let nextJoinAt = new Date(config.virtualStart);
  let nextSnapshotAt = new Date(config.virtualStart);
  let nextProgressAt = new Date(config.virtualStart.getTime() + PROGRESS_INTERVAL_MS);
  let playerIndex = 0;
  let ticks = 0;
  let snapshots = 0;
  let maximumControlledPopulation = 0;
  let faultInjected = false;

  const buildResult = (completedAt: Date): PlaytestRunResult => {
    const metrics = aggregator.finalize(completedAt);
    const warnings = analyzeSoftlocks({
      diagnosticsByBot: Object.fromEntries(
        metrics.bots.map((bot) => [bot.botAlias, collector.diagnostics(bot.botAlias)])
      ),
      metrics,
      virtualStart: config.virtualStart,
      virtualEnd: completedAt,
      thresholds: config.softlockThresholds,
    });
    const warningFixture = configuredWarningFixture(completedAt, population.snapshot());
    if (warningFixture) warnings.push(warningFixture);
    return {
      bootstrap,
      collector,
      population,
      aliases,
      ticks,
      snapshots,
      virtualStart: new Date(config.virtualStart),
      virtualEnd: new Date(completedAt),
      realDurationMs: performance.now() - realStartedAt,
      maximumControlledPopulation,
      metrics,
      warnings,
    };
  };

  try {
    for (;;) {
      while (playerIndex < config.populationLimit && nextJoinAt.getTime() <= now.getTime()) {
        const joined = await joinSyntheticPlayer(
          {
            playerIndex,
            profileWeights: config.profileWeights,
            registry: population,
          },
          context.at(nextJoinAt)
        );
        aliases.registerPopulationMember(joined.member);
        aggregator.registerPopulationMember(joined.member);
        for (const resident of joined.registeredResidents) {
          aliases.registerPopulationMember(resident);
          aggregator.registerPopulationMember(resident);
        }
        playerIndex += 1;
        nextJoinAt = new Date(config.virtualStart.getTime() + playerIndex * config.joinIntervalMs);
        maximumControlledPopulation = Math.max(
          maximumControlledPopulation,
          population.snapshot().length
        );
      }
      if (!faultInjected) {
        await injectConfiguredInvariantFault(population.snapshot());
        faultInjected = true;
      }

      const tick = await runWorldTick(context.at(now));
      ticks += 1;
      collector.consumeWorldTick(tick);
      aggregator.consumeWorldTick(tick);
      await invariantAuditor.auditTick(tick);
      await hooks.afterTick?.(tick);

      if (now.getTime() >= nextSnapshotAt.getTime() || now.getTime() === virtualEnd.getTime()) {
        const snapshot = await loadPlaytestSnapshot(now, aliases);
        collector.consumeSnapshot(snapshot);
        aggregator.consumeSnapshot(snapshot);
        snapshots += 1;
        await hooks.afterSnapshot?.(snapshot);
        while (nextSnapshotAt.getTime() <= now.getTime()) {
          nextSnapshotAt = new Date(nextSnapshotAt.getTime() + config.snapshotIntervalMs);
        }
      }

      if (now.getTime() >= nextProgressAt.getTime() || now.getTime() === virtualEnd.getTime()) {
        hooks.onProgress?.({
          now: new Date(now),
          end: new Date(virtualEnd),
          ticks,
          syntheticPlayers: playerIndex,
          controlledPopulation: population.snapshot().length,
        });
        while (nextProgressAt.getTime() <= now.getTime()) {
          nextProgressAt = new Date(nextProgressAt.getTime() + PROGRESS_INTERVAL_MS);
        }
      }

      if (now.getTime() === virtualEnd.getTime()) break;
      now = new Date(Math.min(now.getTime() + config.stepMs, virtualEnd.getTime()));
    }
  } catch (error) {
    throw new PlaytestRunFailure(error, buildResult(now));
  }

  return buildResult(virtualEnd);
}
