<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { onClickOutside } from '@vueuse/core';
import TopHud from '../components/TopHud.vue';
import StationPanel from '../components/StationPanel.vue';
import { apiClient } from '../lib/api-client';

const stationId = ref<string | null>(null);
const stationName = ref<string | undefined>(undefined);

async function loadUserStation() {
  try {
    const { data } = await apiClient.get('/stations');
    const first = data?.data?.[0];
    if (first) {
      stationId.value = first.id;
      stationName.value = first.name;
    }
  } catch {
    // no station yet
  }
}

const panelOpen = ref(false);
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
  if (isOverStation(x, y) && stationId.value) {
    panelOpen.value = true;
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
  loadUserStation();
});

onUnmounted(() => {
  cancelAnimationFrame(animFrame);
  window.removeEventListener('resize', handleResize);
});

function closePanel() {
  panelOpen.value = false;
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
      <StationPanel
        v-if="panelOpen && stationId"
        ref="panelRef"
        :station-id="stationId"
        :station-name="stationName"
        @close="closePanel"
      />
    </transition>
  </div>
</template>
