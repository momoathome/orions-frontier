import type { PlaytestReport } from './report-schema.js';

function duration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  return `${(ms / 1_000).toFixed(2)}s`;
}

function resourceTotal(resources: Record<string, number | undefined>): number {
  return Object.values(resources).reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
}

export function playtestConsoleSummary(report: PlaytestReport, reportPath: string): string {
  const populationProfiles = Object.entries(
    report.population.reduce<Record<string, number>>((counts, member) => {
      counts[member.profile] = (counts[member.profile] ?? 0) + 1;
      return counts;
    }, {})
  )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([profile, count]) => `${profile}:${count}`)
    .join(', ');
  const milestoneProfiles = report.metrics.profiles
    .map((profile) => {
      const reached = Object.values(profile.milestonesReached as Record<string, number>).reduce(
        (sum, count) => sum + count,
        0
      );
      return `${profile.profile}:${reached}`;
    })
    .join(', ');
  const goals = Object.entries(
    report.metrics.run.goals as Record<string, { selections: number; blocked: number }>
  )
    .map(([goal, values]) => `${goal}=${values.selections}/${values.blocked} blocked`)
    .slice(0, 8)
    .join(', ');
  return [
    `Playtest ${report.status.toUpperCase()} · seed ${report.configuration.seed}`,
    `Virtual ${report.virtualStart} → ${report.virtualEnd} · real ${duration(
      report.operations.realDurationMs
    )} · ${report.operations.ticksPerSecond.toFixed(1)} ticks/s`,
    `Population ${report.population.length} · profiles ${populationProfiles || 'none'}`,
    `Milestones by profile ${milestoneProfiles || 'none'}`,
    `Goals ${goals || 'no goal selections'}`,
    `Economy delivered ${resourceTotal(
      report.metrics.run.economy.deliveredResources as Record<string, number>
    )}, discarded ${resourceTotal(
      report.metrics.run.economy.discardedResources as Record<string, number>
    )} · attacks ${report.metrics.run.conflict.attacks} · viable/eligible/visible targets ${
      report.metrics.run.conflict.viableTargets
    }/${report.metrics.run.conflict.eligibleAfterProtectionAndCooldown}/${
      report.metrics.run.conflict.visibleTargets
    } in ${report.metrics.run.conflict.opportunitySamples} samples`,
    `Findings ${report.invariantFindings.length} hard / ${report.warnings.length} warnings`,
    `Report ${reportPath}`,
  ].join('\n');
}
