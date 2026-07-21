import type { ResourceKey } from './resource.js';

export interface StationResearch {
  key: string;
  name: string;
  description: string;
  points: number;
  duration: number;
  costs: { resourceKey: ResourceKey; amount: number }[];
  status: 'available' | 'researching' | 'completed';
  completesAt: string | null;
}

export interface ResearchState {
  capacity: number;
  used: number;
  technologies: StationResearch[];
}
