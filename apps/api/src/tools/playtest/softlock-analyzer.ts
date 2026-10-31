import { required } from '@orions-frontier/shared';
import type { PlaytestDiagnostic } from './collector.js';
import type { SoftlockThresholds } from './config.js';
import { resourceTotal, type BotMetrics, type PlaytestMetrics } from './metrics.js';

export type PlaytestWarningCode =
  | 'long_blocked_goal'
  | 'no_measurable_progress'
  | 'unstable_colony'
  | 'repeated_action_without_progress'
  | 'goal_churn'
  | 'unreachable_resource_without_expansion'
  | 'storage_capacity_bottleneck'
  | 'hangar_capacity_bottleneck'
  | 'queue_capacity_bottleneck'
  | 'warlord_without_attack_chance'
  | 'warlord_ignored_attack_chance'
  | 'peaceful_profile_without_economic_progress';

export interface PlaytestWarning {
  code: PlaytestWarningCode;
  severity: 'warning';
  affectedAliases: string[];
  windowStart: string;
  windowEnd: string;
  measurements: Record<string, string | number | boolean | null>;
  explanation: string;
}

export interface SoftlockAnalysisInput {
  diagnosticsByBot: Record<string, readonly PlaytestDiagnostic[]>;
  metrics: PlaytestMetrics;
  virtualStart: Date;
  virtualEnd: Date;
  thresholds: SoftlockThresholds;
}

function timeOf(diagnostic: PlaytestDiagnostic): number {
  if (diagnostic.kind === 'bot_decision') return new Date(diagnostic.decidedAt).getTime();
  if (diagnostic.kind === 'state_snapshot') return new Date(diagnostic.capturedAt).getTime();
  return new Date(diagnostic.occurredAt).getTime();
}

function warning(
  code: PlaytestWarningCode,
  botAlias: string,
  windowStart: number,
  windowEnd: number,
  measurements: PlaytestWarning['measurements'],
  explanation: string
): PlaytestWarning {
  return {
    code,
    severity: 'warning',
    affectedAliases: [botAlias],
    windowStart: new Date(windowStart).toISOString(),
    windowEnd: new Date(windowEnd).toISOString(),
    measurements: Object.fromEntries(
      Object.entries(measurements).sort(([left], [right]) => left.localeCompare(right))
    ),
    explanation,
  };
}

function decisionDiagnostics(diagnostics: readonly PlaytestDiagnostic[]) {
  return diagnostics
    .filter((diagnostic) => diagnostic.kind === 'bot_decision')
    .sort((left, right) => timeOf(left) - timeOf(right));
}

function snapshotDiagnostics(diagnostics: readonly PlaytestDiagnostic[]) {
  return diagnostics
    .filter((diagnostic) => diagnostic.kind === 'state_snapshot')
    .sort((left, right) => timeOf(left) - timeOf(right));
}

function spanForReason(
  diagnostics: ReturnType<typeof decisionDiagnostics>,
  pattern: RegExp
): { start: number; end: number; count: number } | null {
  const matching = diagnostics.filter((decision) => pattern.test(decision.normalizedReason));
  if (matching.length === 0) return null;
  return {
    start: timeOf(required(matching[0], 'matching[0]')),
    end: timeOf(required(matching.at(-1), 'matching.at(-1)')),
    count: matching.length,
  };
}

function analyzeBlockedGoal(
  bot: BotMetrics,
  diagnostics: ReturnType<typeof decisionDiagnostics>,
  thresholds: SoftlockThresholds
): PlaytestWarning | null {
  type BlockedDecision = (typeof diagnostics)[number];
  interface BlockedSpan {
    decisions: BlockedDecision[];
    goalType: string | null;
    targetRef: string | null;
  }
  const spans: BlockedSpan[] = [];
  let spanOpen = false;
  for (const decision of diagnostics) {
    if (decision.resultKind !== 'blocked') {
      spanOpen = false;
      continue;
    }
    const goalType = decision.activeGoalAfter ?? decision.activeGoalBefore;
    const targetRef = decision.activeGoalTargetAfter ?? decision.activeGoalTargetBefore;
    const last = spans.at(-1);
    if (spanOpen && last?.goalType === goalType && last.targetRef === targetRef) {
      last.decisions.push(decision);
    } else {
      spans.push({ decisions: [decision], goalType, targetRef });
    }
    spanOpen = true;
  }

  const blocked = spans
    .filter((span) => span.decisions.length >= 2)
    .map((span) => ({
      ...span,
      start: timeOf(required(span.decisions[0], 'span.decisions[0]')),
      end: timeOf(required(span.decisions.at(-1), 'span.decisions.at(-1)')),
    }))
    .filter((span) => span.end - span.start >= thresholds.blockedGoalMs)
    .sort(
      (left, right) => right.end - right.start - (left.end - left.start) || left.start - right.start
    )[0];
  if (!blocked) return null;
  return warning(
    'long_blocked_goal',
    bot.botAlias,
    blocked.start,
    blocked.end,
    {
      blockedDecisions: blocked.decisions.length,
      durationMs: blocked.end - blocked.start,
      goalType: blocked.goalType,
      targetRef: blocked.targetRef,
    },
    'The bot remained continuously blocked on the same goal and target for longer than the configured window.'
  );
}

function analyzeNoProgress(
  bot: BotMetrics,
  diagnostics: readonly PlaytestDiagnostic[],
  thresholds: SoftlockThresholds
): PlaytestWarning | null {
  const snapshots = snapshotDiagnostics(diagnostics);
  if (snapshots.length < 2) return null;
  const spans: {
    start: number;
    end: number;
    snapshots: number;
    progressFingerprint: string;
  }[] = [];
  let spanStart = 0;
  for (let index = 1; index <= snapshots.length; index += 1) {
    const changed =
      index === snapshots.length ||
      required(snapshots[index], 'snapshots[index]').progressFingerprint !==
        required(snapshots[index - 1], 'snapshots[index - 1]').progressFingerprint;
    if (changed) {
      spans.push({
        start: timeOf(required(snapshots[spanStart], 'snapshots[spanStart]')),
        end: timeOf(required(snapshots[index - 1], 'snapshots[index - 1]')),
        snapshots: index - spanStart,
        progressFingerprint: required(snapshots[index - 1], 'snapshots[index - 1]')
          .progressFingerprint,
      });
      spanStart = index;
    }
  }
  const qualifying = spans.filter((span) => span.end - span.start >= thresholds.noProgressMs);
  if (qualifying.length === 0) return null;
  const first = required(qualifying[0], 'qualifying[0]');
  const longest = required(
    [...qualifying].sort(
      (left, right) => right.end - right.start - (left.end - left.start) || left.start - right.start
    )[0],
    'longest span'
  );
  const current = required(spans.at(-1), 'spans.at(-1)');
  const currentDuration = current.end - current.start;
  return warning(
    'no_measurable_progress',
    bot.botAlias,
    longest.start,
    longest.end,
    {
      currentWindowActive: currentDuration >= thresholds.noProgressMs,
      currentWindowDurationMs: currentDuration,
      currentWindowStart: new Date(current.start).toISOString(),
      firstWindowDurationMs: first.end - first.start,
      firstWindowStart: new Date(first.start).toISOString(),
      longestWindowDurationMs: longest.end - longest.start,
      longestWindowStart: new Date(longest.start).toISOString(),
      progressFingerprint: longest.progressFingerprint,
      unchangedSnapshots: longest.snapshots,
    },
    'The compact state fingerprint had at least one unchanged window beyond the configured threshold; first, longest and current windows are reported separately.'
  );
}

function analyzeRepeatedAction(
  bot: BotMetrics,
  diagnostics: readonly PlaytestDiagnostic[],
  thresholds: SoftlockThresholds
): PlaytestWarning | null {
  const ordered = [...diagnostics].sort((left, right) => timeOf(left) - timeOf(right));
  let run: Extract<PlaytestDiagnostic, { kind: 'bot_decision' }>[] = [];
  let fingerprints = new Set<string>();
  let fingerprintObservations = 0;
  for (const diagnostic of ordered) {
    if (diagnostic.kind === 'state_snapshot') {
      fingerprints.add(diagnostic.progressFingerprint);
      fingerprintObservations += 1;
      continue;
    }
    if (diagnostic.kind !== 'bot_decision') {
      run = [];
      fingerprints = new Set();
      fingerprintObservations = 0;
      continue;
    }
    if (diagnostic.resultKind === 'waiting') {
      run = [];
      fingerprints = new Set();
      fingerprintObservations = 0;
      continue;
    }
    const previous = run.at(-1);
    const same =
      previous?.action === diagnostic.action &&
      previous.normalizedReason === diagnostic.normalizedReason &&
      !diagnostic.hasProgress;
    if (!same) {
      run = diagnostic.hasProgress ? [] : [diagnostic];
      fingerprints = new Set();
      fingerprintObservations = 0;
    } else {
      run.push(diagnostic);
    }
    if (
      run.length >= thresholds.repeatedActionCount &&
      fingerprintObservations >= 2 &&
      fingerprints.size === 1
    ) {
      return warning(
        'repeated_action_without_progress',
        bot.botAlias,
        timeOf(required(run[0], 'run[0]')),
        timeOf(required(run.at(-1), 'run.at(-1)')),
        {
          action: diagnostic.action,
          normalizedReason: diagnostic.normalizedReason,
          repetitions: run.length,
        },
        'The same unsuccessful action repeated without a state fingerprint change.'
      );
    }
  }
  return null;
}

function analyzeGoalChurn(
  bot: BotMetrics,
  diagnostics: ReturnType<typeof decisionDiagnostics>,
  thresholds: SoftlockThresholds
): PlaytestWarning | null {
  const switches = diagnostics.filter(
    (decision) =>
      decision.activeGoalBefore !== null &&
      decision.activeGoalAfter !== null &&
      decision.activeGoalBefore !== decision.activeGoalAfter
  );
  for (const switchDecision of switches) {
    const start = timeOf(switchDecision);
    const withinHour = switches.filter((decision) => {
      const time = timeOf(decision);
      return time >= start && time <= start + 3_600_000;
    });
    if (withinHour.length > thresholds.goalSwitchesPerHour) {
      return warning(
        'goal_churn',
        bot.botAlias,
        start,
        timeOf(required(withinHour.at(-1), 'withinHour.at(-1)')),
        { switches: withinHour.length, windowMs: 3_600_000 },
        'Goal switching exceeded the configured hourly threshold.'
      );
    }
  }
  return null;
}

function analyzeBot(
  bot: BotMetrics,
  diagnostics: readonly PlaytestDiagnostic[],
  virtualStart: number,
  virtualEnd: number,
  thresholds: SoftlockThresholds
): PlaytestWarning[] {
  const warnings: PlaytestWarning[] = [];
  const decisions = decisionDiagnostics(diagnostics);
  for (const candidate of [
    analyzeBlockedGoal(bot, decisions, thresholds),
    analyzeNoProgress(bot, diagnostics, thresholds),
    analyzeRepeatedAction(bot, diagnostics, thresholds),
    analyzeGoalChurn(bot, decisions, thresholds),
  ]) {
    if (candidate) warnings.push(candidate);
  }

  const joinedAt = new Date(bot.joinedAt).getTime();
  const participationStart = Math.max(virtualStart, joinedAt);
  const participationMs = Math.max(0, virtualEnd - participationStart);
  for (const [stationAlias, colony] of Object.entries(bot.expansion.coloniesByStation)) {
    const colonyAt = new Date(colony.foundedAt).getTime();
    if (
      colony.stabilizationDurationMs !== null ||
      virtualEnd - colonyAt < thresholds.unstableColonyMs
    ) {
      continue;
    }
    const colonyWarning = warning(
      'unstable_colony',
      bot.botAlias,
      Math.max(colonyAt, participationStart),
      virtualEnd,
      { durationMs: virtualEnd - colonyAt, stationAlias },
      'This founded colony did not reach the stable-colony milestone in time.'
    );
    colonyWarning.affectedAliases.push(stationAlias);
    warnings.push(colonyWarning);
  }

  const resourceSpan = spanForReason(
    decisions,
    /insufficient|saving resources|cannot afford|no mineable|resource/i
  );
  if (
    bot.economy.unreachableResourceNeeds > 0 &&
    bot.expansion.expeditions === 0 &&
    resourceSpan &&
    virtualEnd - resourceSpan.start >= thresholds.capacityBottleneckMs
  ) {
    warnings.push(
      warning(
        'unreachable_resource_without_expansion',
        bot.botAlias,
        Math.max(resourceSpan.start, participationStart),
        virtualEnd,
        {
          resourceNeedDecisions: bot.economy.unreachableResourceNeeds,
          expeditions: bot.expansion.expeditions,
        },
        'Resource needs remained unresolved without an exploration response.'
      )
    );
  }

  for (const [stationAlias, durationMs] of Object.entries(
    bot.economy.fullStorageDurationByStationMs
  )) {
    if (durationMs < thresholds.capacityBottleneckMs) continue;
    const storageWarning = warning(
      'storage_capacity_bottleneck',
      bot.botAlias,
      participationStart,
      virtualEnd,
      {
        fullStorageDurationMs: durationMs,
        observationWindowMs: participationMs,
        stationAlias,
      },
      'This station was observed full for more accumulated station time than the configured capacity window.'
    );
    storageWarning.affectedAliases.push(stationAlias);
    warnings.push(storageWarning);
  }
  const hangarSpan = spanForReason(decisions, /hangar|crew capacity/i);
  if (hangarSpan && hangarSpan.end - hangarSpan.start >= thresholds.capacityBottleneckMs) {
    warnings.push(
      warning(
        'hangar_capacity_bottleneck',
        bot.botAlias,
        hangarSpan.start,
        hangarSpan.end,
        { matchingDecisions: hangarSpan.count, durationMs: hangarSpan.end - hangarSpan.start },
        'Hangar or crew-capacity reasons persisted beyond the configured window.'
      )
    );
  }
  if (
    participationMs >= thresholds.capacityBottleneckMs &&
    bot.development.snapshotSamples > 0 &&
    bot.development.queueUtilization >= 0.95
  ) {
    warnings.push(
      warning(
        'queue_capacity_bottleneck',
        bot.botAlias,
        participationStart,
        virtualEnd,
        {
          queueUtilization: bot.development.queueUtilization,
          snapshotSamples: bot.development.snapshotSamples,
        },
        'Construction queues were occupied in at least 95% of observed snapshots.'
      )
    );
  }

  if (
    bot.profile === 'warlord' &&
    participationMs >= thresholds.coreMilestoneMs &&
    bot.conflict.attacks === 0 &&
    bot.conflict.opportunitySamples > 0
  ) {
    const hadViableTarget = bot.conflict.viableTargets > 0;
    warnings.push(
      warning(
        hadViableTarget ? 'warlord_ignored_attack_chance' : 'warlord_without_attack_chance',
        bot.botAlias,
        participationStart,
        virtualEnd,
        {
          attacks: 0,
          eligibleAfterProtectionAndCooldown: bot.conflict.eligibleAfterProtectionAndCooldown,
          opportunitySamples: bot.conflict.opportunitySamples,
          opportunityStages: JSON.stringify(bot.conflict.opportunityStages),
          sufficientFleetAndReserve: bot.conflict.sufficientFleetAndReserve,
          viableTargets: bot.conflict.viableTargets,
          visibleTargets: bot.conflict.visibleTargets,
        },
        hadViableTarget
          ? 'The warlord observed at least one viable attack target but did not launch an attack.'
          : 'The warlord had no viable attack target during its observed opportunity samples.'
      )
    );
  }
  if (
    bot.profile !== 'warlord' &&
    participationMs >= thresholds.coreMilestoneMs &&
    resourceTotal(bot.economy.deliveredResources) === 0 &&
    bot.development.completedResearch === 0 &&
    bot.expansion.expeditions === 0
  ) {
    warnings.push(
      warning(
        'peaceful_profile_without_economic_progress',
        bot.botAlias,
        participationStart,
        virtualEnd,
        {
          deliveredResources: 0,
          completedResearch: 0,
          expeditions: 0,
        },
        'A peaceful profile reached no economic, research or exploration progress milestone.'
      )
    );
  }
  return warnings;
}

export function analyzeSoftlocks(input: SoftlockAnalysisInput): PlaytestWarning[] {
  const virtualStart = input.virtualStart.getTime();
  const virtualEnd = input.virtualEnd.getTime();
  const warnings = input.metrics.bots.flatMap((bot) =>
    analyzeBot(
      bot,
      input.diagnosticsByBot[bot.botAlias] ?? [],
      virtualStart,
      virtualEnd,
      input.thresholds
    )
  );
  return warnings.sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      left.affectedAliases.join(':').localeCompare(right.affectedAliases.join(':')) ||
      left.windowStart.localeCompare(right.windowStart)
  );
}
