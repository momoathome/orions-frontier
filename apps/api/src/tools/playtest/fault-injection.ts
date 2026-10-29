import { and, eq } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { stationResources } from '../../lib/db/schema/station-resources.js';
import type { PlaytestPopulationMember } from './population.js';
import type { PlaytestWarning } from './softlock-analyzer.js';

function assertFaultInjectionAllowed(): void {
  if (process.env['PLAYTEST_MODE'] !== '1') {
    throw new Error('Playtest fault injection is only available in isolated playtest mode');
  }
}

export async function injectConfiguredInvariantFault(
  members: readonly PlaytestPopulationMember[]
): Promise<void> {
  const injection = process.env['PLAYTEST_INJECT_INVARIANT'];
  if (!injection) return;
  assertFaultInjectionAllowed();
  if (injection !== 'negative-resource') {
    throw new Error(`Unknown playtest invariant injection: ${injection}`);
  }
  const player = members.find((member) => member.populationKind === 'synthetic_player');
  if (!player) throw new Error('Invariant injection requires a synthetic player');
  await getDb()
    .update(stationResources)
    .set({ amount: -1 })
    .where(
      and(
        eq(stationResources.stationId, player.initialStationId),
        eq(stationResources.resourceKey, 'carbon')
      )
    );
}

export function configuredWarningFixture(
  now: Date,
  members: readonly PlaytestPopulationMember[]
): PlaytestWarning | null {
  if (process.env['PLAYTEST_INJECT_WARNING'] !== '1') return null;
  assertFaultInjectionAllowed();
  const member = members[0];
  if (!member) throw new Error('Warning injection requires a controlled population');
  return {
    code: 'no_measurable_progress',
    severity: 'warning',
    affectedAliases: [member.alias],
    windowStart: member.joinedAt.toISOString(),
    windowEnd: now.toISOString(),
    measurements: { fixture: true },
    explanation: 'Injected warning fixture for the end-to-end warning exit-path test.',
  };
}
