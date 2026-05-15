export const resourceKeys = [
  'carbon',
  'titanium',
  'hydrogenium',
  'kyber_crystal',
  'astatine',
] as const;

export type ResourceKey = (typeof resourceKeys)[number];

export type ResourceMap = Partial<Record<ResourceKey, number>>;

export type ResourceRarity = 'common' | 'rare' | 'epic';

export interface ResourceDefinition {
  key: ResourceKey;
  name: string;
  image: string;
  rarity: ResourceRarity;
}
