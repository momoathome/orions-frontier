import { createHash } from 'node:crypto';
import { z } from 'zod';
import { GOAL_BOT_STRATEGY, GOAL_BOT_STRATEGY_VERSION } from '../../services/bot/index.js';
import type { PlaytestConfig } from './config.js';
import type { PlaytestInvariantFinding } from './invariants.js';
import type { PlaytestRunResult } from './runner.js';
import type { PlaytestMetrics } from './metrics.js';
import type { PlaytestWarning } from './softlock-analyzer.js';
import type { PlaytestCollectorSummary } from './collector.js';

const finiteNumber = z.number();
const stringNumberRecord = z.record(z.string(), finiteNumber);
const findingSchema = z.object({
  code: z.string().min(1),
  virtualTime: z.string().min(1),
  affectedAliases: z.array(z.string()),
  values: z.record(z.string(), z.union([z.string(), finiteNumber, z.boolean(), z.null()])),
});
const warningSchema = z.object({
  code: z.string().min(1),
  severity: z.literal('warning'),
  affectedAliases: z.array(z.string()),
  windowStart: z.string().min(1),
  windowEnd: z.string().min(1),
  measurements: z.record(z.string(), z.union([z.string(), finiteNumber, z.boolean(), z.null()])),
  explanation: z.string().min(1),
});

function validatePublicValue(
  // eslint-disable-next-line no-restricted-syntax -- durchläuft beliebige JSON-Werte rekursiv.
  value: unknown,
  context: z.RefinementCtx,
  path: PropertyKey[] = []
): void {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    context.addIssue({ code: 'custom', path, message: 'Report numbers must be finite' });
    return;
  }
  if (typeof value === 'string') {
    if (
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(value)
    ) {
      context.addIssue({ code: 'custom', path, message: 'Raw UUIDs are forbidden in reports' });
    }
    if (/postgres(?:ql)?:\/\/|password_hash|jwt_secret/i.test(value)) {
      context.addIssue({ code: 'custom', path, message: 'Secrets are forbidden in reports' });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      validatePublicValue(entry, context, [...path, index]);
    });
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      validatePublicValue(entry, context, [...path, key]);
    }
  }
}

export const playtestReportSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    status: z.enum(['success', 'failed']),
    configuration: z.object({
      seed: z.string().min(1),
      virtualStart: z.string().min(1),
      durationMs: finiteNumber.nonnegative(),
      stepMs: finiteNumber.positive(),
      joinIntervalMs: finiteNumber.positive(),
      populationLimit: z.number().int().positive(),
      profileWeights: stringNumberRecord,
      snapshotIntervalMs: finiteNumber.positive(),
      outputDirectory: z.string().min(1),
      diagnosticWindowSize: z.number().int().positive(),
      softlockThresholds: z.record(z.string(), finiteNumber),
    }),
    configHash: z.string().regex(/^[0-9a-f]{16}$/),
    virtualStart: z.string().min(1),
    virtualEnd: z.string().min(1),
    worldChecksum: z.string().regex(/^[0-9a-f]{64}$/),
    strategy: z.object({ name: z.string(), version: z.string() }),
    population: z.array(
      z.object({
        alias: z.string().min(1),
        populationKind: z.enum(['resident_bot', 'synthetic_player']),
        profile: z.string().min(1),
        joinedAt: z.string().min(1),
        initialStationAlias: z.string().min(1),
      })
    ),
    metrics: z.object({
      bots: z.array(z.object({ botAlias: z.string() }).loose()),
      profiles: z.array(z.object({ profile: z.string() }).loose()),
      run: z.object({ bots: finiteNumber.nonnegative() }).loose(),
      stations: z.array(z.object({ stationAlias: z.string() }).loose()),
      world: z.object({ stations: finiteNumber.nonnegative() }).loose(),
      finalSnapshotAt: z.string().nullable(),
    }),
    invariantFindings: z.array(findingSchema),
    warnings: z.array(warningSchema),
    collector: z.object({
      completionEvents: finiteNumber.nonnegative(),
      duplicateCompletionEvents: finiteNumber.nonnegative(),
      botDecisions: finiteNumber.nonnegative(),
      snapshots: finiteNumber.nonnegative(),
      eventCounts: stringNumberRecord,
      actionCounts: stringNumberRecord,
      resultCounts: stringNumberRecord,
    }),
    operations: z.object({
      realDurationMs: finiteNumber.nonnegative(),
      ticks: z.number().int().nonnegative(),
      ticksPerSecond: finiteNumber.nonnegative(),
      snapshots: z.number().int().nonnegative(),
      maximumControlledPopulation: z.number().int().nonnegative(),
    }),
  })
  .superRefine((report, context) => {
    validatePublicValue(report, context);
  });

export interface PublicPlaytestConfig {
  seed: string;
  virtualStart: string;
  durationMs: number;
  stepMs: number;
  joinIntervalMs: number;
  populationLimit: number;
  profileWeights: Record<string, number>;
  snapshotIntervalMs: number;
  outputDirectory: string;
  diagnosticWindowSize: number;
  softlockThresholds: Record<string, number>;
}

export interface PlaytestReport {
  schemaVersion: '1.0.0';
  status: 'success' | 'failed';
  configuration: PublicPlaytestConfig;
  configHash: string;
  virtualStart: string;
  virtualEnd: string;
  worldChecksum: string;
  strategy: { name: string; version: string };
  population: {
    alias: string;
    populationKind: 'resident_bot' | 'synthetic_player';
    profile: string;
    joinedAt: string;
    initialStationAlias: string;
  }[];
  metrics: PlaytestMetrics;
  invariantFindings: PlaytestInvariantFinding[];
  warnings: PlaytestWarning[];
  collector: PlaytestCollectorSummary;
  operations: {
    realDurationMs: number;
    ticks: number;
    ticksPerSecond: number;
    snapshots: number;
    maximumControlledPopulation: number;
  };
}

export function publicPlaytestConfig(config: PlaytestConfig): PublicPlaytestConfig {
  return {
    seed: config.seed,
    virtualStart: config.virtualStart.toISOString(),
    durationMs: config.durationMs,
    stepMs: config.stepMs,
    joinIntervalMs: config.joinIntervalMs,
    populationLimit: config.populationLimit,
    profileWeights: config.profileWeights,
    snapshotIntervalMs: config.snapshotIntervalMs,
    outputDirectory: config.outputDirectory,
    diagnosticWindowSize: config.diagnosticWindowSize,
    softlockThresholds: { ...config.softlockThresholds },
  };
}

export function playtestConfigHash(config: PlaytestConfig): string {
  return createHash('sha256')
    .update(JSON.stringify(publicPlaytestConfig(config)))
    .digest('hex')
    .slice(0, 16);
}

export function createPlaytestReport(params: {
  status: 'success' | 'failed';
  config: PlaytestConfig;
  result: PlaytestRunResult;
  invariantFindings?: PlaytestInvariantFinding[];
}): PlaytestReport {
  const { config, result } = params;
  const realSeconds = result.realDurationMs / 1_000;
  const report: PlaytestReport = {
    schemaVersion: '1.0.0',
    status: params.status,
    configuration: publicPlaytestConfig(config),
    configHash: playtestConfigHash(config),
    virtualStart: result.virtualStart.toISOString(),
    virtualEnd: result.virtualEnd.toISOString(),
    worldChecksum: result.bootstrap.checksum,
    strategy: { name: GOAL_BOT_STRATEGY, version: GOAL_BOT_STRATEGY_VERSION },
    population: result.population
      .snapshot()
      .map((member) => ({
        alias: member.alias,
        populationKind: member.populationKind,
        profile: member.profile,
        joinedAt: member.joinedAt.toISOString(),
        initialStationAlias: result.aliases.station(member.initialStationId),
      }))
      .sort((left, right) => left.alias.localeCompare(right.alias)),
    metrics: result.metrics,
    invariantFindings: [...(params.invariantFindings ?? [])].sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        left.affectedAliases.join(':').localeCompare(right.affectedAliases.join(':'))
    ),
    warnings: [...result.warnings],
    collector: result.collector.summary(),
    operations: {
      realDurationMs: result.realDurationMs,
      ticks: result.ticks,
      ticksPerSecond: realSeconds > 0 ? result.ticks / realSeconds : 0,
      snapshots: result.snapshots,
      maximumControlledPopulation: result.maximumControlledPopulation,
    },
  };
  playtestReportSchema.parse(report);
  return report;
}
