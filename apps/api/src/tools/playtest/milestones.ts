export const milestoneKeys = [
  'firstMining',
  'stableInitialStation',
  'threeMolesAndTitan',
  'firstResearch',
  'spectralAnalysis',
  'firstExpedition',
  'firstColony',
  'stableColony',
  'firstDefense',
  'firstAttack',
  'firstRetaliation',
  'firstSalvage',
] as const;

export type MilestoneKey = (typeof milestoneKeys)[number];
export type Milestones = Partial<Record<MilestoneKey, string>>;

export function recordMilestone(
  milestones: Milestones,
  milestone: MilestoneKey,
  occurredAt: Date | string
): void {
  if (milestones[milestone]) return;
  milestones[milestone] =
    occurredAt instanceof Date ? occurredAt.toISOString() : new Date(occurredAt).toISOString();
}
