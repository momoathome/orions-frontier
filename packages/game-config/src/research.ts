import type { ResourceKey } from '@orions-frontier/shared';

export interface ResearchDefinition {
  key: string;
  name: string;
  description: string;
  points: number;
  duration: number;
  costs: { resourceKey: ResourceKey; amount: number }[];
}

export const researchDefinitions: ResearchDefinition[] = [
  {
    key: 'automated_shipyard',
    name: 'Automated Shipyard',
    description: 'Coordinates fabrication drones and reduces spacecraft construction time by 10%.',
    points: 5,
    duration: 120,
    costs: [
      { resourceKey: 'carbon', amount: 200 },
      { resourceKey: 'titanium', amount: 150 },
    ],
  },
];

export const getResearchDefinition = (key: string): ResearchDefinition | undefined =>
  researchDefinitions.find((definition) => definition.key === key);
