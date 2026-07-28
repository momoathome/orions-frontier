import type { BotProfile } from '../../lib/db/schema/bot-controllers.js';

/**
 * Profile parameters used by the goal-driven bot strategy (goal-driven-v1).
 * These are bot-strategy-internal values, not shared gameplay rules.
 */
export interface ProfileParams {
  futureWeight: number;
  riskWeight: number;
  colonizationFactor: number;
  aggressionFactor: number;
}

export const PROFILE_PARAMS: Record<BotProfile, ProfileParams> = {
  industrialist: {
    futureWeight: 1.0,
    riskWeight: 1.3,
    colonizationFactor: 0.8,
    aggressionFactor: 0.5,
  },
  pioneer: { futureWeight: 1.1, riskWeight: 1.0, colonizationFactor: 1.5, aggressionFactor: 0.7 },
  technocrat: {
    futureWeight: 1.5,
    riskWeight: 1.0,
    colonizationFactor: 0.9,
    aggressionFactor: 0.8,
  },
  warlord: { futureWeight: 0.9, riskWeight: 0.7, colonizationFactor: 0.8, aggressionFactor: 1.5 },
};

/**
 * Deterministically assigns a bot profile from a stable key.
 * Uses SeededRng with the provided seed to ensure reproducibility.
 */
export function profileForKey(seed: string): BotProfile {
  // Simple hash-based deterministic selection
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const profiles: BotProfile[] = ['industrialist', 'pioneer', 'technocrat', 'warlord'];
  return profiles[hash % profiles.length]!;
}
