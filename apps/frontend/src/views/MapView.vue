<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { onClickOutside } from '@vueuse/core';
import TopHud from '../components/TopHud.vue';

type Section = 'buildings' | 'fleet' | 'mining' | 'defense';

const panelOpen = ref(false);
const selectedSection = ref<Section | null>(null);
const selectedBuilding = ref<any | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const hoveringStation = ref(false);

onClickOutside(panelRef, () => {
  if (panelOpen.value) closePanel();
});

let animFrame: number;
let stars: { x: number; y: number; r: number; a: number; twinkle: number }[] = [];
let t = 0;
let stationRect = { x: 0, y: 0, w: 120, h: 78 };

const buildings = ref([
  {
    id: 1,
    name: 'Core',
    level: 12,
    nextLevel: 13,
    description: 'Expands overall station capacity and resource throughput.',
    buildTime: '2m 14s',
    queued: true,
    progress: 65,
    costs: [
      { name: 'Metal', amount: '12,000' },
      { name: 'Crystal', amount: '8,000' },
    ],
  },
  {
    id: 2,
    name: 'Hangar',
    level: 8,
    nextLevel: 9,
    description: 'Increases fleet capacity and reduces docking time by 15%.',
    buildTime: '4m 51s',
    queued: false,
    progress: 0,
    costs: [
      { name: 'Metal', amount: '22,000' },
      { name: 'Crystal', amount: '16,000' },
    ],
  },
  {
    id: 3,
    name: 'Scanner',
    level: 5,
    nextLevel: 6,
    description: 'Extends detection range for asteroids and hostile ships.',
    buildTime: '1m 33s',
    queued: false,
    progress: 0,
    costs: [
      { name: 'Metal', amount: '8,000' },
      { name: 'Crystal', amount: '4,000' },
    ],
  },
  {
    id: 4,
    name: 'Defense Grid',
    level: 3,
    nextLevel: 4,
    description: 'Upgrades station turrets and shielding systems.',
    buildTime: '6m 12s',
    queued: false,
    progress: 0,
    costs: [
      { name: 'Metal', amount: '31,000' },
      { name: 'Crystal', amount: '18,000' },
    ],
  },
]);

const activeBuilding = computed(() => selectedBuilding.value ?? buildings.value[0]);

function initStars(w: number, h: number) {
  stars = Array.from({ length: 200 }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: Math.random() * 1.2 + 0.2,
    a: Math.random() * 0.7 + 0.2,
    twinkle: Math.random() * Math.PI * 2,
  }));
}

function drawBracket(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  flipX: boolean,
  flipY: boolean
) {
  const dx = flipX ? -size : size;
  const dy = flipY ? -size : size;
  ctx.beginPath();
  ctx.moveTo(x + dx, y);
  ctx.lineTo(x, y);
  ctx.lineTo(x, y + dy);
  ctx.stroke();
}

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  t += 0.016;

  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = 'rgba(0, 160, 220, 0.035)';
  ctx.lineWidth = 1;
  const gs = 80;
  for (let x = 0; x < W; x += gs) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += gs) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // Stars (twinkling)
  for (const s of stars) {
    const a = s.a * (0.5 + 0.5 * Math.sin(t * 0.4 + s.twinkle));
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(200, 220, 255, ${a})`;
    ctx.fill();
  }

  // Asteroids
  const asteroids = [
    { rx: 0.18, ry: 0.28, r: 12 },
    { rx: 0.72, ry: 0.61, r: 16 },
    { rx: 0.57, ry: 0.43, r: 8 },
    { rx: 0.14, ry: 0.66, r: 10 },
    { rx: 0.83, ry: 0.31, r: 7 },
  ];
  for (const a of asteroids) {
    const ax = a.rx * W,
      ay = a.ry * H;
    ctx.beginPath();
    ctx.arc(ax, ay, a.r, 0, Math.PI * 2);
    ctx.fillStyle = '#3d3830';
    ctx.fill();
    ctx.strokeStyle = 'rgba(100, 90, 80, 0.4)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  // Dashed flight paths
  ctx.setLineDash([6, 12]);
  ctx.strokeStyle = 'rgba(0, 200, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W * 0.17, H * 0.29);
  ctx.lineTo(W * 0.5, H * 0.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(W * 0.73, H * 0.2);
  ctx.lineTo(W * 0.5, H * 0.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(W * 0.14, H * 0.66);
  ctx.lineTo(W * 0.5, H * 0.5);
  ctx.stroke();
  ctx.setLineDash([]);

  // Station
  const sx = W / 2;
  const sy = H / 2;
  const sw = 120,
    sh = 78;
  stationRect = { x: sx - sw / 2, y: sy - sh / 2, w: sw, h: sh };

  // Station glow
  const glowA = 0.12 + 0.05 * Math.sin(t * 0.7);
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 180);
  glow.addColorStop(0, `rgba(0, 180, 255, ${glowA * 1.6})`);
  glow.addColorStop(0.5, `rgba(0, 100, 200, ${glowA})`);
  glow.addColorStop(1, 'rgba(0, 30, 80, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sx, sy, 180, 0, Math.PI * 2);
  ctx.fill();

  // Pulse ring
  const pulseR = 88 + 10 * Math.sin(t * 0.6);
  ctx.beginPath();
  ctx.arc(sx, sy, pulseR, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(0, 200, 255, ${0.07 + 0.05 * Math.sin(t * 0.6)})`;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Station fill
  ctx.fillStyle = 'rgba(0, 35, 75, 0.4)';
  ctx.fillRect(stationRect.x, stationRect.y, sw, sh);

  // Station border
  const bAlpha = hoveringStation.value ? 0.95 : 0.65 + 0.25 * Math.sin(t * 0.5);
  ctx.strokeStyle = `rgba(0, 200, 255, ${bAlpha})`;
  ctx.lineWidth = 1;
  ctx.strokeRect(stationRect.x + 0.5, stationRect.y + 0.5, sw - 1, sh - 1);

  // Inner crosshairs
  ctx.strokeStyle = 'rgba(0, 200, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(stationRect.x, sy);
  ctx.lineTo(stationRect.x + sw, sy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx, stationRect.y);
  ctx.lineTo(sx, stationRect.y + sh);
  ctx.stroke();

  // Corner brackets (RTS selection style)
  const bracketColor = hoveringStation.value ? 'rgba(0, 255, 180, 1)' : 'rgba(0, 230, 200, 0.8)';
  ctx.strokeStyle = bracketColor;
  ctx.lineWidth = 2;
  const bs = 12;
  drawBracket(ctx, stationRect.x, stationRect.y, bs, false, false);
  drawBracket(ctx, stationRect.x + sw, stationRect.y, bs, true, false);
  drawBracket(ctx, stationRect.x, stationRect.y + sh, bs, false, true);
  drawBracket(ctx, stationRect.x + sw, stationRect.y + sh, bs, true, true);

  // Center dot
  ctx.beginPath();
  ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0, 240, 200, ${0.7 + 0.3 * Math.sin(t * 1.8)})`;
  ctx.fill();

  // Label above station
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = hoveringStation.value ? 'rgba(0, 240, 200, 0.9)' : 'rgba(0, 200, 255, 0.55)';
  ctx.fillText('[ STATION OMEGA ]', sx, stationRect.y - 7);

  // Full-screen crosshair (very faint)
  ctx.strokeStyle = 'rgba(0, 160, 255, 0.03)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx, 0);
  ctx.lineTo(sx, H);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, sy);
  ctx.lineTo(W, sy);
  ctx.stroke();

  animFrame = requestAnimationFrame(draw);
}

function toCanvasCoords(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (canvas.width / rect.width),
    y: (clientY - rect.top) * (canvas.height / rect.height),
  };
}

function isOverStation(x: number, y: number): boolean {
  return (
    x >= stationRect.x &&
    x <= stationRect.x + stationRect.w &&
    y >= stationRect.y &&
    y <= stationRect.y + stationRect.h
  );
}

function handleCanvasClick(e: MouseEvent) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const { x, y } = toCanvasCoords(canvas, e.clientX, e.clientY);
  if (isOverStation(x, y)) {
    panelOpen.value = true;
    selectedSection.value = null;
    selectedBuilding.value = null;
  }
}

function handleCanvasMouseMove(e: MouseEvent) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const { x, y } = toCanvasCoords(canvas, e.clientX, e.clientY);
  hoveringStation.value = isOverStation(x, y);
}

function handleResize() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  initStars(canvas.width, canvas.height);
}

onMounted(() => {
  const canvas = canvasRef.value!;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  initStars(canvas.width, canvas.height);
  draw();
  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  cancelAnimationFrame(animFrame);
  window.removeEventListener('resize', handleResize);
});

function closePanel() {
  panelOpen.value = false;
  selectedSection.value = null;
}

function setSection(s: Section) {
  selectedSection.value = s;
  if (s === 'buildings') selectedBuilding.value = buildings.value[0];
  else selectedBuilding.value = null;
}

function selectBuilding(b: any) {
  selectedBuilding.value = b;
}
</script>

<template>
  <div
    class="relative w-screen h-screen overflow-hidden bg-[#070b14] text-white select-none"
    :class="hoveringStation ? 'cursor-pointer' : 'cursor-default'"
  >
    <!-- Full-screen canvas -->
    <canvas
      ref="canvasRef"
      class="absolute inset-0 block"
      @click="handleCanvasClick"
      @mousemove="handleCanvasMouseMove"
      @mouseleave="hoveringStation = false"
    />

    <!-- Top HUD -->
    <TopHud />

    <!-- Bottom Command Panel -->
    <transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="translate-y-full"
      enter-to-class="translate-y-0"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-from-class="translate-y-0"
      leave-to-class="translate-y-full"
    >
      <div
        v-if="panelOpen"
        ref="panelRef"
        class="absolute bottom-0 left-0 w-full z-20 h-[300px] flex flex-col font-mono"
      >
        <!-- Panel background + border -->
        <div
          class="absolute inset-0 bg-[#060c1b]/97 backdrop-blur-xl border-t-2 border-cyan-500/40"
        />
        <!-- Scanline overlay -->
        <div class="scanlines absolute inset-0 pointer-events-none z-10 opacity-[0.025]" />
        <!-- Corner accents -->
        <div class="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-cyan-400/50 z-10" />
        <div class="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cyan-400/50 z-10" />

        <!-- Content -->
        <div class="relative z-20 flex flex-col h-full">
          <!-- Header row -->
          <div
            class="flex items-center justify-between px-5 h-11 border-b border-white/[0.07] shrink-0"
          >
            <div class="flex items-center gap-5">
              <div class="flex items-center gap-2.5">
                <span class="text-[9px] text-cyan-400/30 uppercase tracking-[0.4em]">Station</span>
                <span class="text-sm font-semibold tracking-widest text-white">OMEGA PRIME</span>
              </div>
              <div class="hidden md:flex items-center gap-4 text-[10px]">
                <div class="flex items-center gap-1.5">
                  <span class="w-1 h-1 rounded-full bg-cyan-400/50" />
                  <span class="text-white/25">Mining</span>
                  <span class="text-cyan-300 tabular-nums">+342/min</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="w-1 h-1 rounded-full bg-green-400/60" />
                  <span class="text-white/25">Missions</span>
                  <span class="text-green-300">3 active</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="w-1 h-1 rounded-full bg-amber-400/70 animate-pulse" />
                  <span class="text-white/25">Queue</span>
                  <span class="text-amber-300">1 active</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="w-1 h-1 rounded-full bg-green-400/60" />
                  <span class="text-white/25">Threat</span>
                  <span class="text-green-400 uppercase text-[9px] tracking-widest">LOW</span>
                </div>
              </div>
            </div>
            <button
              @click="closePanel"
              class="w-7 h-7 flex items-center justify-center rounded text-white/60 hover:text-white/80 hover:bg-white/5 transition text-[11px]"
            >
              ✕
            </button>
          </div>

          <!-- Tab bar -->
          <div
            class="flex items-center gap-0.5 px-4 h-8 border-b border-white/5 bg-[#040911]/60 shrink-0"
          >
            <button
              v-for="tab in ['buildings', 'fleet', 'mining', 'defense'] as Section[]"
              :key="tab"
              @click="setSection(tab)"
              class="px-3 h-5 rounded text-[9px] uppercase tracking-[0.25em] transition"
              :class="
                selectedSection === tab
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/35'
                  : 'text-white/25 hover:text-white/55 hover:bg-white/4'
              "
            >
              {{ tab }}
            </button>
          </div>

          <!-- Empty state -->
          <div v-if="!selectedSection" class="flex-1 flex items-center justify-center">
            <div class="text-center">
              <div class="text-xl text-cyan-500/15 mb-2 tracking-[0.6em]">◎</div>
              <p class="text-white/15 text-[9px] uppercase tracking-[0.4em]">
                Select a command module
              </p>
            </div>
          </div>

          <!-- Buildings -->
          <div
            v-if="selectedSection === 'buildings'"
            class="flex-1 grid grid-cols-[260px_1fr] overflow-hidden"
          >
            <!-- Building list -->
            <div class="border-r border-white/5 overflow-y-auto">
              <div
                v-for="b in buildings"
                :key="b.id"
                @click="selectBuilding(b)"
                class="flex items-center gap-3 px-4 py-2.5 border-b border-white/4 cursor-pointer transition-colors"
                :class="
                  activeBuilding.id === b.id ? 'bg-cyan-500/8' : 'hover:bg-white/2.5'
                "
              >
                <span
                  class="w-1.5 h-1.5 rounded-full shrink-0 mt-0.5"
                  :class="b.queued ? 'bg-amber-400 animate-pulse' : 'bg-cyan-500/40'"
                />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between">
                    <span class="text-[11px] text-white/75">{{ b.name }}</span>
                    <span class="text-[10px] text-cyan-400/50 tabular-nums">Lv.{{ b.level }}</span>
                  </div>
                  <div class="mt-1.5 h-px w-full bg-white/6 rounded-full overflow-hidden">
                    <div
                      v-if="b.queued"
                      class="h-full bg-amber-400/60 rounded-full"
                      :style="{ width: `${b.progress}%` }"
                    />
                  </div>
                </div>
                <span class="text-[9px] text-white/15 shrink-0">▶</span>
              </div>
            </div>

            <!-- Building detail -->
            <div class="overflow-y-auto p-4">
              <div class="flex gap-4 h-full">
                <div class="flex-1 min-w-0">
                  <div class="flex items-baseline gap-2.5 mb-1">
                    <span class="text-[9px] text-cyan-400/35 uppercase tracking-[0.35em]"
                      >Module</span
                    >
                    <span class="text-[15px] font-semibold tracking-wide text-white">{{
                      activeBuilding.name
                    }}</span>
                    <span class="text-[10px] text-white/25 tabular-nums">
                      Lv.{{ activeBuilding.level }} → {{ activeBuilding.nextLevel }}
                    </span>
                  </div>

                  <p class="text-[11px] text-white/35 leading-relaxed mb-4">
                    {{ activeBuilding.description }}
                  </p>

                  <div class="flex items-center gap-2 flex-wrap mb-3">
                    <div
                      v-for="cost in activeBuilding.costs"
                      :key="cost.name"
                      class="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-white/2.5 border border-white/6"
                    >
                      <span class="text-[9px] uppercase tracking-widest text-white/25">{{
                        cost.name
                      }}</span>
                      <span class="text-[11px] text-white/65 tabular-nums">{{ cost.amount }}</span>
                    </div>
                    <div
                      class="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-white/2.5 border border-white/6"
                    >
                      <span class="text-[9px] uppercase tracking-widest text-white/25">Time</span>
                      <span class="text-[11px] text-cyan-300/70 tabular-nums">{{
                        activeBuilding.buildTime
                      }}</span>
                    </div>
                  </div>

                  <div v-if="activeBuilding.queued">
                    <div class="flex items-center justify-between text-[9px] mb-1.5">
                      <span class="text-white/25 uppercase tracking-widest">Upgrading</span>
                      <span class="text-amber-300 tabular-nums"
                        >{{ activeBuilding.progress }}%</span
                      >
                    </div>
                    <div class="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                      <div
                        class="h-full bg-amber-400/65 rounded-full"
                        :style="{ width: `${activeBuilding.progress}%` }"
                      />
                    </div>
                  </div>
                </div>

                <!-- CTA column -->
                <div class="shrink-0 w-36 flex flex-col gap-2 justify-end pb-1">
                  <button
                    class="w-full py-2.5 rounded border text-[10px] uppercase tracking-[0.2em] font-semibold transition"
                    :class="
                      activeBuilding.queued
                        ? 'border-amber-500/25 bg-amber-500/8 text-amber-400/50 cursor-not-allowed'
                        : 'border-cyan-500/40 bg-cyan-500/9 hover:bg-cyan-500/20 text-cyan-200'
                    "
                  >
                    {{ activeBuilding.queued ? 'Upgrading…' : 'Upgrade' }}
                  </button>
                  <button
                    class="w-full py-2 rounded border border-white/5 bg-white/2 hover:bg-white/4 text-[9px] uppercase tracking-widest text-white/25 transition"
                  >
                    Details
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Placeholders -->
          <div
            v-for="section in ['fleet', 'mining', 'defense'] as Section[]"
            v-show="selectedSection === section"
            :key="section"
            class="flex-1 flex items-center justify-center"
          >
            <p class="text-white/15 text-[9px] uppercase tracking-[0.4em]">
              {{ section }} — coming soon
            </p>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.scanlines {
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 1) 2px,
    rgba(0, 0, 0, 1) 4px
  );
}
</style>
