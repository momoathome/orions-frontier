import { botProfiles, type BotProfile } from '../../lib/db/schema/bot-controllers.js';
import { SeededRng } from '../../lib/world-gen/rng.js';

export type BotProfileWeights = Record<BotProfile, number>;

export const EVEN_PROFILE_WEIGHTS: BotProfileWeights = {
  industrialist: 1,
  pioneer: 1,
  technocrat: 1,
  warlord: 1,
};

export function validateProfileWeights(weights: BotProfileWeights): void {
  let total = 0;
  for (const profile of botProfiles) {
    const weight = weights[profile];
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error(`Profile weight for ${profile} must be a finite non-negative number`);
    }
    total += weight;
  }
  if (total <= 0) throw new Error('At least one bot profile weight must be positive');
}

export function selectWeightedProfile(
  seed: string,
  playerIndex: number,
  weights: BotProfileWeights
): BotProfile {
  if (!Number.isInteger(playerIndex) || playerIndex < 0) {
    throw new Error('Synthetic player index must be a non-negative integer');
  }
  validateProfileWeights(weights);

  const total = botProfiles.reduce((sum, profile) => sum + weights[profile], 0);
  let draw = new SeededRng(`${seed}:synthetic-profile:${playerIndex}`).next() * total;
  let selected: BotProfile = botProfiles[0];
  for (const profile of botProfiles) {
    selected = profile;
    draw -= weights[profile];
    if (draw < 0) break;
  }
  return selected;
}
