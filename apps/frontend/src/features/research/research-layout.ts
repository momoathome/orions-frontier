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

export const LANES: { key: ResearchLane; label: string; color: string }[] = [
  { key: 'extraction', label: 'Extraction', color: '#e3a94f' },
  { key: 'sensors', label: 'Navigation and Sensors', color: '#4fc3e8' },
  { key: 'engineering', label: 'Engineering', color: '#70cf8f' },
  { key: 'military', label: 'Military', color: '#e46a5e' },
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

export type Leaf =
  | {
      id: string;
      lane: ResearchLane;
      kind: 'ship';
      name: string;
      requirements: Requirements;
      ship: SpacecraftSeedDefinition;
    }
  | {
      id: string;
      lane: ResearchLane;
      kind: 'defense';
      name: string;
      requirements: Requirements;
      upgrade: DefenseUpgradeSeedDefinition;
    };

// Miners and salvagers sit in Extraction, combat ships and defenses in Military.
export const leaves: Leaf[] = [
  ...spacecrafts.map((ship): Leaf => ({
    id: `ship:${ship.key}`,
    lane: ship.role === 'miner' || ship.role === 'salvager' ? 'extraction' : 'military',
    kind: 'ship',
    name: ship.name,
    requirements: ship.requirements,
    ship,
  })),
  ...defenseUpgrades.map((upgrade): Leaf => ({
    id: `defense:${upgrade.key}`,
    lane: 'military',
    kind: 'defense',
    name: upgrade.name,
    requirements: upgrade.requirements,
    upgrade,
  })),
];

/** Tier in which a research level is usually reached: 1, 2, 3–4, 5–6, 7+. */
const LEVEL_TIER = [1, 1, 2, 3, 3, 4, 4] as const;

/** A ship or defense sits in the tier its highest research level needs, never before that research. */
const leafTier = (leaf: Leaf) =>
  Math.max(
    1,
    ...entriesOf(leaf.requirements.research ?? {}).map(([key, level]) =>
      Math.max(getResearchDefinition(key)?.tier ?? 1, LEVEL_TIER[level] ?? 5)
    )
  );

export interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Units without research requirements (Mole, Armor Plating) are no step in the tree. */
export const treeLeaves = leaves.filter(
  (leaf) => Object.keys(leaf.requirements.research ?? {}).length > 0
);

export interface Band {
  lane: (typeof LANES)[number];
  top: number;
  height: number;
}

// Each lane cell holds its research rows, then its unlocked units stacked below them.
export const boxes = new Map<string, NodeBox>();
export const bands: Band[] = [];
let bandTop = HEADER_HEIGHT;
for (const lane of LANES) {
  let bottom = BAND_TITLE + 2 * ROW_HEIGHT;
  for (const tier of TIERS) {
    const cell = researchDefinitions.filter(
      (definition) => definition.lane === lane.key && definition.tier === tier
    );
    for (const definition of cell) {
      boxes.set(definition.key, {
        x: columnX(tier),
        y: bandTop + BAND_TITLE + LANE_ROW[definition.key] * ROW_HEIGHT,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    }
    let y = BAND_TITLE + Math.max(0, ...cell.map((d) => LANE_ROW[d.key] + 1)) * ROW_HEIGHT;
    for (const leaf of treeLeaves.filter((l) => l.lane === lane.key && leafTier(l) === tier)) {
      boxes.set(leaf.id, {
        x: columnX(tier) + 8,
        y: bandTop + y,
        width: LEAF_WIDTH,
        height: LEAF_HEIGHT,
      });
      y += LEAF_STEP;
    }
    bottom = Math.max(bottom, y);
  }
  bands.push({ lane, top: bandTop, height: bottom + BAND_PAD });
  bandTop += bottom + BAND_PAD;
}

export const CONTENT_WIDTH = columnX(TIERS.length) + NODE_WIDTH + GUTTER;
export const CONTENT_HEIGHT = bandTop;

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
  ...treeLeaves.flatMap((leaf) =>
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
