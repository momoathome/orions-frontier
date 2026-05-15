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
    rarity: 'rare',
  },
  kyber_crystal: {
    key: 'kyber_crystal',
    name: 'Kyber Crystal',
    image: '/assets/resources/kyber_crystal.png',
    rarity: 'epic',
  },
  astatine: {
    key: 'astatine',
    name: 'Astatine',
    image: '/assets/resources/astatine.png',
    rarity: 'rare',
  },
};
