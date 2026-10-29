import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorldTickResult } from '../../services/simulation.service.js';
import type { PlaytestAliasRegistry } from './aliases.js';
import type { PlaytestConfig } from './config.js';
import {
  queryDatabaseInvariantState,
  type DatabaseInvariantCode,
  type RawDatabaseInvariantViolation,
} from './invariant-queries.js';

export type PlaytestInvariantCode =
  | DatabaseInvariantCode
  | 'duplicate_completion_event'
  | 'multiple_successful_bot_actions'
  | 'station_owner_changed'
  | 'unverified_visible_target';

export interface PlaytestInvariantFinding {
  code: PlaytestInvariantCode;
  virtualTime: string;
  affectedAliases: string[];
  values: Record<string, string | number | boolean | null>;
}

export class PlaytestInvariantError extends Error {
  readonly findings: PlaytestInvariantFinding[];

  constructor(findings: PlaytestInvariantFinding[]) {
    super(`Playtest invariant failed: ${findings.map((finding) => finding.code).join(', ')}`);
    this.name = 'PlaytestInvariantError';
    this.findings = structuredClone(findings);
  }
}

function stableFinding(finding: PlaytestInvariantFinding): PlaytestInvariantFinding {
  return {
    ...finding,
    affectedAliases: [...new Set(finding.affectedAliases)].sort(),
    values: Object.fromEntries(
      Object.entries(finding.values).sort(([left], [right]) => left.localeCompare(right))
    ),
  };
}

function databaseFinding(
  now: Date,
  violation: RawDatabaseInvariantViolation,
  aliases: PlaytestAliasRegistry
): PlaytestInvariantFinding {
  const affectedAliases: string[] = [];
  if (violation.userId) affectedAliases.push(aliases.user(violation.userId));
  if (violation.stationId) affectedAliases.push(aliases.station(violation.stationId));
  if (violation.entityKind && violation.entityId) {
    affectedAliases.push(aliases.entity(violation.entityKind, violation.entityId));
  }
  return stableFinding({
    code: violation.code,
    virtualTime: now.toISOString(),
    affectedAliases,
    values: violation.values,
  });
}

export class PlaytestInvariantAuditor {
  private readonly completionEventIds = new Set<string>();
  private readonly stationOwners = new Map<string, string>();

  constructor(private readonly aliases: PlaytestAliasRegistry) {}

  async auditTick(tick: WorldTickResult): Promise<void> {
    const findings: PlaytestInvariantFinding[] = [];
    for (const event of tick.events) {
      if (this.completionEventIds.has(event.eventId)) {
        findings.push(
          stableFinding({
            code: 'duplicate_completion_event',
            virtualTime: tick.now.toISOString(),
            affectedAliases: [this.aliases.user(event.userId)],
            values: {
              eventAlias: this.aliases.entity('completion', event.eventId),
              eventType: event.type,
            },
          })
        );
      } else {
        this.completionEventIds.add(event.eventId);
      }

      if (
        (event.type === 'mining_delivery_completed' ||
          event.type === 'combat_resolved' ||
          event.type === 'salvage_completed') &&
        !event.targetVisibilityVerified
      ) {
        findings.push(
          stableFinding({
            code: 'unverified_visible_target',
            virtualTime: tick.now.toISOString(),
            affectedAliases: [
              this.aliases.user(event.userId),
              this.aliases.station(event.stationId),
            ],
            values: { eventType: event.type },
          })
        );
      }
    }

    const successfulActions = new Map<string, number>();
    for (const decision of tick.botDecisions) {
      if (decision.resultKind !== 'success') continue;
      successfulActions.set(
        decision.botUserId,
        (successfulActions.get(decision.botUserId) ?? 0) + 1
      );
    }
    for (const [userId, count] of successfulActions) {
      if (count <= 1) continue;
      findings.push(
        stableFinding({
          code: 'multiple_successful_bot_actions',
          virtualTime: tick.now.toISOString(),
          affectedAliases: [this.aliases.user(userId)],
          values: { successfulActions: count },
        })
      );
    }

    const database = await queryDatabaseInvariantState(tick.now, this.aliases.userIds(), [
      ...this.stationOwners.keys(),
    ]);
    findings.push(
      ...database.violations.map((violation) => databaseFinding(tick.now, violation, this.aliases))
    );
    for (const owner of database.stationOwners) {
      const previousOwner = this.stationOwners.get(owner.stationId);
      if (previousOwner && previousOwner !== owner.userId) {
        findings.push(
          stableFinding({
            code: 'station_owner_changed',
            virtualTime: tick.now.toISOString(),
            affectedAliases: [
              this.aliases.station(owner.stationId),
              this.aliases.user(previousOwner),
            ],
            values: {
              previousOwnerAlias: this.aliases.user(previousOwner),
              newOwnerIsRegistered: this.aliases.userIds().includes(owner.userId),
            },
          })
        );
      } else if (!previousOwner) {
        this.stationOwners.set(owner.stationId, owner.userId);
      }
    }

    if (findings.length > 0) {
      findings.sort(
        (left, right) =>
          left.code.localeCompare(right.code) ||
          left.affectedAliases.join(':').localeCompare(right.affectedAliases.join(':'))
      );
      throw new PlaytestInvariantError(findings);
    }
  }
}

function safeSeed(seed: string): string {
  return seed.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80);
}

export async function writePartialInvariantReport(
  config: PlaytestConfig,
  error: PlaytestInvariantError
): Promise<string> {
  await mkdir(config.outputDirectory, { recursive: true });
  const filename = `${config.virtualStart.toISOString().replace(/[:.]/g, '-')}-${safeSeed(
    config.seed
  )}-failed.json`;
  const target = join(config.outputDirectory, filename);
  const temporary = `${target}.${process.pid}.tmp`;
  const report = {
    schemaVersion: 'playtest-partial-v1',
    status: 'failed',
    seed: config.seed,
    virtualStart: config.virtualStart.toISOString(),
    effectiveConfig: {
      durationMs: config.durationMs,
      stepMs: config.stepMs,
      joinIntervalMs: config.joinIntervalMs,
      populationLimit: config.populationLimit,
      profileWeights: config.profileWeights,
      snapshotIntervalMs: config.snapshotIntervalMs,
      diagnosticWindowSize: config.diagnosticWindowSize,
      softlockThresholds: config.softlockThresholds,
    },
    invariantFindings: error.findings,
  };
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await rename(temporary, target);
  return target;
}
