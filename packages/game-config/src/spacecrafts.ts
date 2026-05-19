import type { SpacecraftRole, SpacecraftDefinitionCost } from '@orions-frontier/shared';

export interface SpacecraftSeedDefinition {
  key: string;
  name: string;
  description: string;
  role: SpacecraftRole;
  image: string;
  attack: number;
  defense: number;
  cargo: number;
  speed: number;
  miningRate: number;
  buildTime: number;
  costs: SpacecraftDefinitionCost[];
}

export const spacecrafts: SpacecraftSeedDefinition[] = [
  // ── Fighters ────────────────────────────────────────────────────────────────
  {
    key: 'merlin',
    name: 'Merlin',
    description: 'Fast and agile interceptor optimized for hit-and-run attacks.',
    role: 'fighter',
    image: '/assets/spacecrafts/merlin.webp',
    attack: 15,
    defense: 8,
    cargo: 10,
    speed: 120,
    miningRate: 0,
    buildTime: 30,
    costs: [
      { resourceKey: 'carbon', amount: 120 },
      { resourceKey: 'titanium', amount: 80 },
    ],
  },
  {
    key: 'comet',
    name: 'Comet',
    description: 'Balanced interceptor with high speed and solid firepower.',
    role: 'fighter',
    image: '/assets/spacecrafts/comet.webp',
    attack: 20,
    defense: 12,
    cargo: 15,
    speed: 100,
    miningRate: 0,
    buildTime: 45,
    costs: [
      { resourceKey: 'carbon', amount: 160 },
      { resourceKey: 'titanium', amount: 120 },
      { resourceKey: 'hydrogenium', amount: 40 },
    ],
  },
  {
    key: 'javelin',
    name: 'Javelin',
    description: 'Heavy assault fighter with superior firepower and thick plating.',
    role: 'fighter',
    image: '/assets/spacecrafts/javelin.webp',
    attack: 35,
    defense: 20,
    cargo: 20,
    speed: 80,
    miningRate: 0,
    buildTime: 75,
    costs: [
      { resourceKey: 'titanium', amount: 200 },
      { resourceKey: 'hydrogenium', amount: 80 },
      { resourceKey: 'kyber_crystal', amount: 10 },
    ],
  },

  // ── Miners ──────────────────────────────────────────────────────────────────
  {
    key: 'mole',
    name: 'Mole',
    description: 'Compact mining vessel efficient in dense asteroid fields.',
    role: 'miner',
    image: '/assets/spacecrafts/mole.webp',
    attack: 3,
    defense: 3,
    cargo: 150,
    speed: 80,
    miningRate: 100,
    buildTime: 60,
    costs: [
      { resourceKey: 'carbon', amount: 80 },
      { resourceKey: 'titanium', amount: 60 },
      { resourceKey: 'hydrogenium', amount: 50 },
    ],
  },
  {
    key: 'titan',
    name: 'Titan',
    description: 'Large-scale deep space mining platform with massive cargo hold.',
    role: 'miner',
    image: '/assets/spacecrafts/titan.webp',
    attack: 5,
    defense: 10,
    cargo: 850,
    speed: 70,
    miningRate: 350,
    buildTime: 180,
    costs: [
      { resourceKey: 'carbon', amount: 250 },
      { resourceKey: 'titanium', amount: 300 },
      { resourceKey: 'hydrogenium', amount: 150 },
      { resourceKey: 'kyber_crystal', amount: 20 },
    ],
  },

  // ── Transporters ─────────────────────────────────────────────────────────────
  {
    key: 'nomad',
    name: 'Nomad',
    description: 'Light freighter designed for short-range supply runs.',
    role: 'transporter',
    image: '/assets/spacecrafts/nomad.webp',
    attack: 2,
    defense: 5,
    cargo: 200,
    speed: 120,
    miningRate: 0,
    buildTime: 60,
    costs: [
      { resourceKey: 'carbon', amount: 100 },
      { resourceKey: 'titanium', amount: 50 },
    ],
  },
  {
    key: 'hercules',
    name: 'Hercules',
    description: 'Heavy cargo freighter built for bulk inter-station transport.',
    role: 'transporter',
    image: '/assets/spacecrafts/hercules.webp',
    attack: 5,
    defense: 15,
    cargo: 1400,
    speed: 100,
    miningRate: 0,
    buildTime: 180,
    costs: [
      { resourceKey: 'carbon', amount: 300 },
      { resourceKey: 'titanium', amount: 200 },
      { resourceKey: 'hydrogenium', amount: 100 },
    ],
  },
];
