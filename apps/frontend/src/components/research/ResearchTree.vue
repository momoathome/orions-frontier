<script setup lang="ts">
import { computed, onMounted, reactive, useTemplateRef, watch } from 'vue';
import { requirementBlockers } from '@orions-frontier/game-config';
import type { ResearchLane, ResearchTechnology } from '@orions-frontier/shared';
import { formatCountdown } from '../../lib/format';
import { useOverviewStore } from '../../stores/overview.js';
import { useResearchStore } from '../../stores/research.js';
import LockIcon from '../LockIcon.vue';
import {
  bands,
  boxes,
  columnX,
  CONTENT_HEIGHT,
  CONTENT_WIDTH,
  edges,
  LANES,
  NODE_WIDTH,
  TIERS,
  tierGate,
  treeLeaves,
  type NodeBox,
} from './research-layout';

const selected = defineModel<string | null>('selected', { required: true });
const research = useResearchStore();
const overview = useOverviewStore();
const viewport = useTemplateRef<HTMLDivElement>('viewport');

type NodeState = 'locked' | 'available' | 'running' | 'maxed';

function techState(tech: ResearchTechnology): NodeState {
  if (tech.completesAt) return 'running';
  if (tech.level >= tech.definition.maxLevel) return 'maxed';
  return tech.blockers.length === 0 ? 'available' : 'locked';
}

const laneColor = (lane: ResearchLane) =>
  LANES.find((entry) => entry.key === lane)?.color ?? '#5fd6e6';
// Lane colour mixed into the page background: opaque, so edges stay behind the nodes.
const tint = (color: string, percent: number) =>
  `color-mix(in srgb, ${color} ${percent}%, var(--color-ui-bg))`;
const FILL: Record<NodeState, number> = { locked: 8, available: 18, running: 24, maxed: 32 };

const box = (id: string): NodeBox => boxes.get(id) ?? { x: 0, y: 0, width: 0, height: 0 };

const nodes = computed(() =>
  (research.state.research?.technologies ?? []).map((tech) => {
    const state = techState(tech);
    const endsAt = tech.completesAt ? Date.parse(tech.completesAt) : null;
    const { name, maxLevel } = tech.definition;
    const color = laneColor(tech.definition.lane);
    return {
      id: tech.definition.key,
      tech,
      state,
      color,
      border: state === 'locked' ? tint(color, 40) : color,
      fill: tint(color, FILL[state]),
      inner: tint(color, 45),
      box: box(tech.definition.key),
      countdown: endsAt ? formatCountdown(endsAt, overview.state.now) : null,
      label: `${name}, level ${tech.level} of ${maxLevel}, ${state === 'maxed' ? 'max level' : state}`,
    };
  })
);

// Building requirements of ships and defenses count per station, so the tree only checks research.
const leafNodes = computed(() =>
  treeLeaves.map((leaf) => {
    const unlocked =
      requirementBlockers({ research: leaf.requirements.research }, research.levels, {}).length ===
      0;
    const color = laneColor(leaf.lane);
    return {
      leaf,
      unlocked,
      border: unlocked ? color : tint(color, 40),
      box: box(leaf.id),
      label: `${leaf.name}, ${leaf.kind === 'ship' ? 'spacecraft' : 'defense'}, ${unlocked ? 'research done' : 'locked'}`,
    };
  })
);

const edgePaths = computed(() => {
  const colors = new Map(nodes.value.map((node) => [node.id, node.color]));
  return edges
    .filter((edge) => !edge.leaf || selected.value === edge.from || selected.value === edge.to)
    .map((edge) => {
      const from = box(edge.from);
      const to = box(edge.to);
      // Left to right between columns; top to bottom into a node of the same column.
      const sideways = to.x >= from.x + from.width;
      const [x1, y1, x2, y2] = sideways
        ? [from.x + from.width, from.y + from.height / 2, to.x, to.y + to.height / 2]
        : [from.x + from.width / 2, from.y + from.height, to.x + to.width / 2, to.y];
      const bend = sideways ? (x2 - x1) / 2 : (y2 - y1) / 2;
      return {
        id: `${edge.from}-${edge.to}`,
        d: sideways
          ? `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`
          : `M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`,
        met: (research.levels[edge.from] ?? 0) >= edge.level,
        active: selected.value === edge.from || selected.value === edge.to,
        color: colors.get(edge.from) ?? '#5fd6e6',
      };
    })
    .map((edge) => ({
      ...edge,
      // Unmet edges stay neutral; met or selected ones take the colour of their source lane.
      stroke: edge.active || edge.met ? edge.color : '#23344c',
      opacity: edge.active ? 1 : edge.met ? 0.5 : 1,
    }));
});

// Pan and zoom: one CSS transform on the content, driven by pointer and wheel events.
const MIN_SCALE = 0.3;
const MAX_SCALE = 1.6;
const view = reactive({ x: 0, y: 0, scale: 1 });
const pointers = new Map<number, { x: number; y: number }>();
let travelled = 0;
let pinchDistance = 0;

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

function zoomAt(clientX: number, clientY: number, factor: number) {
  const rect = viewport.value?.getBoundingClientRect();
  if (!rect) return;
  const scale = clampScale(view.scale * factor);
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  view.x = px - ((px - view.x) * scale) / view.scale;
  view.y = py - ((py - view.y) * scale) / view.scale;
  view.scale = scale;
}

function zoomCenter(factor: number) {
  const rect = viewport.value?.getBoundingClientRect();
  if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
}

function fit() {
  const rect = viewport.value?.getBoundingClientRect();
  if (!rect) return;
  view.scale = clampScale(Math.min(rect.width / CONTENT_WIDTH, rect.height / CONTENT_HEIGHT, 1));
  view.x = (rect.width - CONTENT_WIDTH * view.scale) / 2;
  view.y = Math.max(0, (rect.height - CONTENT_HEIGHT * view.scale) / 2);
}

function centerOn(id: string) {
  const rect = viewport.value?.getBoundingClientRect();
  const target = boxes.get(id);
  if (!rect || !target) return;
  view.scale = Math.max(view.scale, 0.8);
  view.x = rect.width / 2 - (target.x + target.width / 2) * view.scale;
  view.y = rect.height / 3 - (target.y + target.height / 2) * view.scale;
}

function onPointerDown(event: PointerEvent) {
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 1) travelled = 0;
}

function onPointerMove(event: PointerEvent) {
  const previous = pointers.get(event.pointerId);
  if (!previous) return;
  const next = { x: event.clientX, y: event.clientY };
  pointers.set(event.pointerId, next);
  if (pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return;
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDistance > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, distance / pinchDistance);
    pinchDistance = distance;
    return;
  }
  view.x += next.x - previous.x;
  view.y += next.y - previous.y;
  travelled += Math.abs(next.x - previous.x) + Math.abs(next.y - previous.y);
  // Capture only once it is a drag, so a plain click still reaches the node button.
  if (travelled > 4 && !viewport.value?.hasPointerCapture(event.pointerId)) {
    viewport.value?.setPointerCapture(event.pointerId);
  }
}

function onPointerUp(event: PointerEvent) {
  pointers.delete(event.pointerId);
  pinchDistance = 0;
}

// A drag that ends on a node is no click; keyboard clicks (detail 0) always select.
function select(id: string, event: MouseEvent) {
  if (event.detail > 0 && travelled > 4) return;
  selected.value = id;
}

onMounted(() => {
  const focus = research.state.focus;
  if (focus && boxes.has(focus)) {
    selected.value = focus;
    centerOn(focus);
  } else {
    fit();
  }
});
// Chips and requirement rows elsewhere jump to a node while the view is open.
watch(
  () => research.state.focus,
  (focus) => {
    if (!focus || !boxes.has(focus)) return;
    selected.value = focus;
    centerOn(focus);
  }
);
</script>

<template>
  <div
    ref="viewport"
    class="relative h-full min-h-0 cursor-grab touch-none overflow-hidden bg-ui-bg active:cursor-grabbing"
    aria-label="Research tree"
    role="group"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel.prevent="zoomAt($event.clientX, $event.clientY, Math.exp(-$event.deltaY * 0.0015))"
  >
    <div
      class="absolute left-0 top-0 origin-top-left"
      :style="{
        width: `${CONTENT_WIDTH}px`,
        height: `${CONTENT_HEIGHT}px`,
        transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
      }"
    >
      <!-- Lane bands in their colour and tier headings -->
      <div
        v-for="band in bands"
        :key="band.lane.key"
        class="absolute inset-x-0 border-t border-ui-line"
        :style="{
          top: `${band.top}px`,
          height: `${band.height}px`,
          background: tint(band.lane.color, 6),
          boxShadow: `inset 4px 0 0 ${band.lane.color}`,
        }"
      >
        <span
          class="absolute left-6 top-1.5 text-xs font-semibold uppercase tracking-[0.12em]"
          :style="{ color: band.lane.color }"
          >{{ band.lane.label }}</span
        >
      </div>
      <div
        v-for="tier in TIERS"
        :key="tier"
        class="absolute top-3.5 flex flex-col gap-0.5"
        :style="{ left: `${columnX(tier)}px`, width: `${NODE_WIDTH}px` }"
      >
        <span class="text-[13px] font-semibold text-ui-bright">Tier {{ tier }}</span>
        <span class="truncate text-xs text-ui-dim">{{ tierGate(tier) }}</span>
      </div>

      <svg
        class="pointer-events-none absolute inset-0"
        :width="CONTENT_WIDTH"
        :height="CONTENT_HEIGHT"
        aria-hidden="true"
      >
        <path
          v-for="edge in edgePaths"
          :key="edge.id"
          :d="edge.d"
          fill="none"
          :stroke="edge.stroke"
          :stroke-opacity="edge.opacity"
          :stroke-width="edge.active ? 2 : 1.5"
        />
      </svg>

      <button
        v-for="node in nodes"
        :key="node.id"
        type="button"
        class="absolute flex flex-col justify-center gap-0.5 rounded-md border px-3 text-left transition hover:brightness-125 focus-visible:outline-2 focus-visible:outline-ui-cyan"
        :class="[
          node.state === 'locked' ? 'text-ui-muted' : 'text-ui-bright',
          selected === node.id ? 'ring-2 ring-ui-cyan' : '',
        ]"
        :style="{
          left: `${node.box.x}px`,
          top: `${node.box.y}px`,
          width: `${node.box.width}px`,
          height: `${node.box.height}px`,
          borderColor: node.border,
          background: node.fill,
        }"
        :aria-label="node.label"
        :aria-pressed="selected === node.id"
        @click="select(node.id, $event)"
      >
        <!-- Capabilities get the inner frame of the mockup, stat research a single border. -->
        <span
          v-if="node.tech.definition.kind === 'capability'"
          class="pointer-events-none absolute inset-[3px] rounded border"
          :style="{ borderColor: node.inner }"
          aria-hidden="true"
        />
        <span class="flex items-center gap-1.5 text-[13px] font-semibold">
          <LockIcon v-if="node.state === 'locked'" />
          <span class="truncate">{{ node.tech.definition.name }}</span>
        </span>
        <span class="flex items-baseline justify-between gap-2 text-xs">
          <span
            class="ui-num"
            :class="node.state === 'locked' ? 'text-ui-dim' : ''"
            :style="node.state === 'locked' ? undefined : { color: node.color }"
            >{{ node.tech.level }}/{{ node.tech.definition.maxLevel }}</span
          >
          <span v-if="node.countdown" class="ui-num text-ui-amber">{{ node.countdown }}</span>
          <span v-else-if="node.state === 'maxed'" :style="{ color: node.color }">Max</span>
        </span>
      </button>

      <button
        v-for="node in leafNodes"
        :key="node.leaf.id"
        type="button"
        class="absolute flex items-center gap-1.5 rounded-full border border-dashed bg-ui-bg px-3 text-left text-xs transition hover:brightness-125 focus-visible:outline-2 focus-visible:outline-ui-cyan"
        :class="[
          node.unlocked ? 'text-ui-soft' : 'text-ui-dim',
          selected === node.leaf.id ? 'ring-2 ring-ui-cyan' : '',
        ]"
        :style="{
          left: `${node.box.x}px`,
          top: `${node.box.y}px`,
          width: `${node.box.width}px`,
          height: `${node.box.height}px`,
          borderColor: node.border,
        }"
        :aria-label="node.label"
        :aria-pressed="selected === node.leaf.id"
        @click="select(node.leaf.id, $event)"
      >
        <span aria-hidden="true">{{ node.leaf.kind === 'ship' ? '▲' : '◆' }}</span>
        <span class="truncate">{{ node.leaf.name }}</span>
        <LockIcon v-if="!node.unlocked" class="ml-auto" />
      </button>
    </div>

    <div class="absolute bottom-3 left-3 flex gap-1" @pointerdown.stop>
      <button
        type="button"
        class="ui-btn ui-btn-icon bg-ui-panel"
        aria-label="Zoom in"
        @click="zoomCenter(1.25)"
      >
        +
      </button>
      <button
        type="button"
        class="ui-btn ui-btn-icon bg-ui-panel"
        aria-label="Zoom out"
        @click="zoomCenter(0.8)"
      >
        −
      </button>
      <button type="button" class="ui-btn h-9 bg-ui-panel px-3" @click="fit">Fit</button>
    </div>
    <p
      v-if="!research.state.research"
      class="absolute left-1/2 top-1/2 -translate-x-1/2 text-ui-muted"
      :class="research.state.error ? 'text-ui-red' : 'animate-pulse'"
    >
      {{ research.state.error ?? 'Loading research…' }}
    </p>
  </div>
</template>
