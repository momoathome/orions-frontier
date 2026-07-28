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
  {
    key: 'extraction_algorithms',
    name: 'Extraction Algorithms',
    description: 'Increases mining rate of station miners by 10%.',
    points: 5,
    duration: 120,
    costs: [
      { resourceKey: 'carbon', amount: 200 },
      { resourceKey: 'titanium', amount: 150 },
    ],
  },
  {
    key: 'modular_cargo_frames',
    name: 'Modular Cargo Frames',
    description: 'Increases cargo capacity of miners and salvagers by 10%.',
    points: 5,
    duration: 120,
    costs: [
      { resourceKey: 'carbon', amount: 200 },
      { resourceKey: 'titanium', amount: 150 },
    ],
  },
  {
    key: 'vector_navigation',
    name: 'Vector Navigation',
    description: 'Reduces travel time for all new trips from this station by 10%.',
    points: 5,
    duration: 120,
    costs: [
      { resourceKey: 'carbon', amount: 200 },
      { resourceKey: 'titanium', amount: 150 },
    ],
  },
  {
    key: 'combat_analytics',
    name: 'Combat Analytics',
    description: 'Increases attack power of attacking fighters from this station by 10%.',
    points: 5,
    duration: 120,
    costs: [
      { resourceKey: 'carbon', amount: 200 },
      { resourceKey: 'titanium', amount: 150 },
    ],
  },
  {
    key: 'station_grid_optimization',
    name: 'Station Grid Optimization',
    description: 'Reduces building and defense upgrade time at this station by 10%.',
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
