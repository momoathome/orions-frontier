import type { ResourceDefinition, ResourceKey } from '@orions-frontier/shared';

export const resources: Record<ResourceKey, ResourceDefinition> = {
  carbon: {
    key: 'carbon',
    name: 'Carbon',
    image: '/assets/resources/carbon.png',
    rarity: 'common',
  },
  titanium: {
    key: 'titanium',
    name: 'Titanium',
    image: '/assets/resources/titanium.png',
    rarity: 'common',
  },
  hydrogenium: {
    key: 'hydrogenium',
    name: 'Hydrogenium',
    image: '/assets/resources/hydrogenium.png',
    rarity: 'common',
  },
  kyber_crystal: {
    key: 'kyber_crystal',
    name: 'Kyber Crystal',
    image: '/assets/resources/kyber_crystal.png',
    rarity: 'rare',
  },
  astatine: {
    key: 'astatine',
    name: 'Astatine',
    image: '/assets/resources/astatine.png',
    rarity: 'rare',
  },
};

/** Cost of the first colony; every further station multiplies it by 1.5. */
export const COLONIZATION_COST = {
  carbon: 8_000,
  titanium: 8_000,
  hydrogenium: 3_000,
} as const satisfies Partial<Record<ResourceKey, number>>;

/** Colonization cost for a player who already owns `stationCount` stations. */
export const calculateColonizationCost = (stationCount: number) => {
  const factor = 1.5 ** Math.max(0, stationCount - 1);
  return {
    carbon: Math.round(COLONIZATION_COST.carbon * factor),
    titanium: Math.round(COLONIZATION_COST.titanium * factor),
    hydrogenium: Math.round(COLONIZATION_COST.hydrogenium * factor),
  } satisfies Partial<Record<ResourceKey, number>>;
};

/** Duration in milliseconds before a new account loses its attack protection. */
export const ATTACK_PROTECTION_DURATION_MS = 24 * 60 * 60 * 1_000;
