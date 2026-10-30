<script setup lang="ts">
import { computed, onMounted, reactive, useTemplateRef, watch } from 'vue';
import { requirementBlockers } from '@orions-frontier/game-config';
import type { ResearchTechnology } from '@orions-frontier/shared';
import { formatCountdown } from '../../lib/format';
import { useOverviewStore } from '../../stores/overview.js';
import { useResearchStore } from '../../stores/research.js';
import {
  BAND_HEIGHT,
  boxes,
  columnX,
  CONTENT_HEIGHT,
  CONTENT_WIDTH,
  edges,
  LANES,
  LEAF_BAND_TOP,
  laneTop,
  leaves,
  NODE_WIDTH,
  TIERS,
  tierGate,
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

const STATE_CLASS: Record<NodeState, string> = {
  locked: 'border-ui-line bg-ui-card text-ui-muted opacity-60',
  available: 'border-[#2b8a99] bg-[#10333c] text-ui-bright',
  running: 'border-[#8a6a24] bg-[#2a200b] text-ui-bright',
  maxed: 'border-green-500/40 bg-green-500/10 text-ui-bright',
};
const LEVEL_CLASS: Record<NodeState, string> = {
  locked: 'text-ui-dim',
  available: 'text-ui-cyan',
  running: 'text-ui-amber',
  maxed: 'text-ui-green',
};

const box = (id: string): NodeBox => boxes.get(id) ?? { x: 0, y: 0, width: 0, height: 0 };

const nodes = computed(() =>
  (research.state.research?.technologies ?? []).map((tech) => {
    const state = techState(tech);
    const endsAt = tech.completesAt ? Date.parse(tech.completesAt) : null;
    const { name, maxLevel } = tech.definition;
    return {
      id: tech.definition.key,
      tech,
      state,
      box: box(tech.definition.key),
      countdown: endsAt ? formatCountdown(endsAt, overview.state.now) : null,
      label: `${name}, level ${tech.level} of ${maxLevel}, ${state === 'maxed' ? 'max level' : state}`,
    };
  })
);

// Building requirements of ships and defenses count per station, so the tree only checks research.
const leafNodes = computed(() =>
  leaves.map((leaf) => {
    const unlocked =
      requirementBlockers({ research: leaf.requirements.research }, research.levels, {}).length ===
      0;
    return {
      leaf,
      unlocked,
      box: box(leaf.id),
      label: `${leaf.name}, ${leaf.kind === 'ship' ? 'spacecraft' : 'defense'}, ${unlocked ? 'research done' : 'locked'}`,
    };
  })
);

const edgePaths = computed(() =>
  edges
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
      };
    })
    .map((edge) => {
      let stroke = '#23344c';
      if (edge.active) stroke = '#5fd6e6';
      else if (edge.met) stroke = '#2b8a99';
      return { ...edge, stroke };
    })
);

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
      <!-- Lane bands and tier headings -->
      <div
        v-for="(lane, index) in LANES"
        :key="lane.key"
        class="absolute inset-x-0 border-t border-ui-line"
        :class="index % 2 === 0 ? 'bg-white/[0.015]' : ''"
        :style="{ top: `${laneTop(index)}px`, height: `${BAND_HEIGHT}px` }"
      >
        <span class="ui-label absolute left-6 top-1.5">{{ lane.label }}</span>
      </div>
      <div
        class="absolute inset-x-0 bottom-0 border-t border-ui-line"
        :style="{ top: `${LEAF_BAND_TOP}px` }"
      >
        <span class="ui-label absolute left-6 top-1.5">Ships and defense</span>
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
          :stroke-width="edge.active ? 2 : 1.5"
        />
      </svg>

      <button
        v-for="node in nodes"
        :key="node.id"
        type="button"
        class="absolute flex flex-col justify-center gap-0.5 border px-3 text-left transition hover:brightness-125 focus-visible:outline-2 focus-visible:outline-ui-cyan"
        :class="[
          STATE_CLASS[node.state],
          node.tech.definition.kind === 'capability' ? 'rounded-[27px] px-4' : 'rounded-md',
          selected === node.id ? 'ring-2 ring-ui-cyan' : '',
        ]"
        :style="{
          left: `${node.box.x}px`,
          top: `${node.box.y}px`,
          width: `${node.box.width}px`,
          height: `${node.box.height}px`,
        }"
        :aria-label="node.label"
        :aria-pressed="selected === node.id"
        @click="select(node.id, $event)"
      >
        <span class="truncate text-[13px] font-semibold">
          <span v-if="node.state === 'locked'" aria-hidden="true">🔒 </span
          >{{ node.tech.definition.name }}
        </span>
        <span class="flex items-baseline justify-between gap-2 text-xs">
          <span class="ui-num" :class="LEVEL_CLASS[node.state]"
            >{{ node.tech.level }}/{{ node.tech.definition.maxLevel }}</span
          >
          <span v-if="node.countdown" class="ui-num text-ui-amber">{{ node.countdown }}</span>
          <span v-else-if="node.state === 'maxed'" class="text-ui-green">Max</span>
        </span>
      </button>

      <button
        v-for="node in leafNodes"
        :key="node.leaf.id"
        type="button"
        class="absolute flex items-center gap-1.5 truncate rounded border border-dashed px-2 text-left text-xs transition hover:brightness-125 focus-visible:outline-2 focus-visible:outline-ui-cyan"
        :class="[
          node.unlocked ? 'border-ui-line-strong text-ui-soft' : 'border-ui-line text-ui-dim',
          selected === node.leaf.id ? 'ring-2 ring-ui-cyan' : '',
        ]"
        :style="{
          left: `${node.box.x}px`,
          top: `${node.box.y}px`,
          width: `${node.box.width}px`,
          height: `${node.box.height}px`,
        }"
        :aria-label="node.label"
        :aria-pressed="selected === node.leaf.id"
        @click="select(node.leaf.id, $event)"
      >
        <span aria-hidden="true">{{ node.leaf.kind === 'ship' ? '▲' : '◆' }}</span>
        <span class="truncate">{{ node.leaf.name }}</span>
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
