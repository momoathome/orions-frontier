import {
  defenseUpgrades,
  getResearchDefinition,
  RESEARCH_TIERS,
  researchDefinitions,
  spacecrafts,
  type DefenseUpgradeSeedDefinition,
  type SpacecraftSeedDefinition,
} from '@orions-frontier/game-config';
import {
  entriesOf,
  type Requirements,
  type ResearchKey,
  type ResearchLane,
  type ResearchTier,
} from '@orions-frontier/shared';

// Columns are tiers, bands are lanes; the graph is laid out once in content pixels.
export const NODE_WIDTH = 184;
export const NODE_HEIGHT = 54;
export const LEAF_WIDTH = 150;
export const LEAF_HEIGHT = 28;
const COLUMN_WIDTH = 236;
const GUTTER = 24;
const HEADER_HEIGHT = 64;
const BAND_TITLE = 28;
const ROW_HEIGHT = 70;
const BAND_PAD = 14;
const LEAF_STEP = 36;
export const BAND_HEIGHT = BAND_TITLE + 2 * ROW_HEIGHT + BAND_PAD;

export const LANES: { key: ResearchLane; label: string }[] = [
  { key: 'extraction', label: 'Extraction' },
  { key: 'sensors', label: 'Navigation and Sensors' },
  { key: 'engineering', label: 'Engineering' },
  { key: 'military', label: 'Military' },
];
export const TIERS: ResearchTier[] = [1, 2, 3, 4, 5];

/** Row inside the lane band, chosen so prerequisite edges cross as little as possible. */
const LANE_ROW: Record<ResearchKey, 0 | 1> = {
  extraction_algorithms: 0,
  cargo_compression: 1,
  auto_reroute: 0,
  deep_core_drilling: 1,
  autonomous_fleet: 0,
  ion_propulsion: 0,
  sensor_arrays: 1,
  long_range_survey: 0,
  spectral_analysis: 1,
  colony_logistics: 0,
  signature_analysis: 1,
  deep_spectral_analysis: 1,
  frontier_charter: 0,
  construction_robotics: 0,
  fabrication_lines: 1,
  parallel_construction: 0,
  research_network: 1,
  nanite_assembly: 0,
  weapons: 0,
  armor: 1,
  shields: 1,
  fleet_coordination: 0,
};

export const columnX = (tier: number) => GUTTER + (tier - 1) * COLUMN_WIDTH;
export const laneTop = (index: number) => HEADER_HEIGHT + index * BAND_HEIGHT;
export const LEAF_BAND_TOP = laneTop(LANES.length);

export type Leaf =
  | {
      id: string;
      kind: 'ship';
      name: string;
      requirements: Requirements;
      ship: SpacecraftSeedDefinition;
    }
  | {
      id: string;
      kind: 'defense';
      name: string;
      requirements: Requirements;
      upgrade: DefenseUpgradeSeedDefinition;
    };

export const leaves: Leaf[] = [
  ...spacecrafts.map((ship): Leaf => ({
    id: `ship:${ship.key}`,
    kind: 'ship',
    name: ship.name,
    requirements: ship.requirements,
    ship,
  })),
  ...defenseUpgrades.map((upgrade): Leaf => ({
    id: `defense:${upgrade.key}`,
    kind: 'defense',
    name: upgrade.name,
    requirements: upgrade.requirements,
    upgrade,
  })),
];

/** A ship or defense sits under the tier of its latest research requirement. */
const leafTier = (leaf: Leaf) =>
  Math.max(
    1,
    ...entriesOf(leaf.requirements.research ?? {}).map(
      ([key]) => getResearchDefinition(key)?.tier ?? 1
    )
  );

export interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const boxes = new Map<string, NodeBox>();
for (const definition of researchDefinitions) {
  const lane = LANES.findIndex((entry) => entry.key === definition.lane);
  boxes.set(definition.key, {
    x: columnX(definition.tier),
    y: laneTop(lane) + BAND_TITLE + LANE_ROW[definition.key] * ROW_HEIGHT,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  });
}
const leafCounts = new Map<number, number>();
for (const leaf of leaves) {
  const tier = leafTier(leaf);
  const index = leafCounts.get(tier) ?? 0;
  leafCounts.set(tier, index + 1);
  boxes.set(leaf.id, {
    x: columnX(tier),
    y: LEAF_BAND_TOP + BAND_TITLE + index * LEAF_STEP,
    width: LEAF_WIDTH,
    height: LEAF_HEIGHT,
  });
}

export const CONTENT_WIDTH = columnX(TIERS.length) + NODE_WIDTH + GUTTER;
export const CONTENT_HEIGHT =
  LEAF_BAND_TOP + BAND_TITLE + Math.max(...leafCounts.values()) * LEAF_STEP + BAND_PAD;

/** Research prerequisites as edges; `leaf` edges only show around the selected node. */
export interface Edge {
  from: ResearchKey;
  to: string;
  level: number;
  leaf: boolean;
}
export const edges: Edge[] = [
  ...researchDefinitions.flatMap((definition) =>
    entriesOf(definition.requirements.research ?? {}).map(([from, level]) => ({
      from,
      to: definition.key,
      level,
      leaf: false,
    }))
  ),
  ...leaves.flatMap((leaf) =>
    entriesOf(leaf.requirements.research ?? {}).map(([from, level]) => ({
      from,
      to: leaf.id,
      level,
      leaf: true,
    }))
  ),
];

/** "Laboratory 5, Spectral Analysis" under each tier heading. */
export const tierGate = (tier: ResearchTier) => {
  const { buildings, research } = RESEARCH_TIERS[tier].requirements;
  return [
    ...(buildings?.laboratory ? [`Laboratory ${buildings.laboratory}`] : []),
    ...entriesOf(research ?? {}).map(([key]) => getResearchDefinition(key)?.name ?? key),
  ].join(', ');
};
