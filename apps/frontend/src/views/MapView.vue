<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import TopHud from '../components/TopHud.vue';
import StationPanel from '../components/StationPanel.vue';
import AsteroidPanel from '../components/AsteroidPanel.vue';
import { apiClient } from '../lib/api-client';
import { wsClient } from '../lib/ws-client';
import { WorldRenderer } from '../lib/world/index.js';
import type { StationInfo, AssignedAsteroid, ActiveTrip } from '../lib/world/index.js';
import { useSelectionStore } from '../stores/selection';

const selectionStore = useSelectionStore();

// ── Station data ─────────────────────────────────────────────────────────────

const stationId = ref<string | null>(null);
const stationName = ref<string | undefined>(undefined);
const stationPanelOpen = ref(false);
const isDragging = ref(false);
const hoveringEntity = ref(false);

async function loadUserStation(): Promise<StationInfo | null> {
  try {
    const { data } = await apiClient.get('/stations');
    const first = data?.data?.[0];
    if (first) {
      stationId.value = first.id;
      stationName.value = first.name;
      return { x: first.x ?? 0, y: first.y ?? 0, name: first.name };
    }
  } catch {
    // no station yet
  }
  return null;
}

// ── Active trips (in-flight spacecraft) ─────────────────────────────────────

async function loadTrips(): Promise<void> {
  if (!renderer) return;
  try {
    const { data } = await apiClient.get('/me/trips');
    const raw = (data?.data ?? []) as Array<{
      id: string;
      fromType: string;
      fromId: string;
      toType: string;
      toId: string;
      departedAt: string;
      arrivesAt: string;
      purpose: string;
      groupSize: number;
    }>;

    // We need world coordinates for from/to — look them up from loaded map data
    // For now, map fromId/toId → coordinates using stationInfo and asteroid positions
    const trips: ActiveTrip[] = [];
    for (const t of raw) {
      const fromPos = resolveEndpointCoords(t.fromType, t.fromId);
      const toPos = resolveEndpointCoords(t.toType, t.toId);
      if (!fromPos || !toPos) continue;
      trips.push({
        id: t.id,
        fromX: fromPos.x,
        fromY: fromPos.y,
        toX: toPos.x,
        toY: toPos.y,
        departedAt: new Date(t.departedAt).getTime(),
        arrivesAt: new Date(t.arrivesAt).getTime(),
        purpose: t.purpose as ActiveTrip['purpose'],
        groupSize: t.groupSize,
      });
    }
    renderer.setActiveTrips(trips);
  } catch {
    // non-fatal
  }
}

/** Resolve world coordinates for a trip endpoint. */
function resolveEndpointCoords(type: string, id: string): { x: number; y: number } | null {
  if (type === 'station' && stationInfo && stationId.value === id) {
    return { x: stationInfo.x, y: stationInfo.y };
  }
  if (type === 'asteroid' && renderer) {
    return renderer.getAsteroidWorldPos(id);
  }
  return null;
}

// ── Assignment markers ───────────────────────────────────────────────────

async function loadAssignments(): Promise<void> {
  if (!renderer || !stationId.value) return;
  try {
    const { data } = await apiClient.get(`/stations/${stationId.value}/mining-assignments`);
    const raw = (data?.data?.assignments ?? []) as Array<{
      asteroidId: string;
      asteroidX: number;
      asteroidY: number;
      asteroidSize: string;
    }>;
    // Deduplicate by asteroid (multiple assignment rows → same asteroid)
    const seen = new Set<string>();
    const asteroids: AssignedAsteroid[] = [];
    for (const a of raw) {
      if (!seen.has(a.asteroidId)) {
        seen.add(a.asteroidId);
        asteroids.push({
          asteroidId: a.asteroidId,
          x: a.asteroidX,
          y: a.asteroidY,
          size: a.asteroidSize,
        });
      }
    }
    renderer.setAssignedAsteroids(asteroids);
  } catch {
    // non-fatal — markers simply won't show
  }
}

// ── PixiJS World Renderer ────────────────────────────────────────────────────

const worldRef = ref<HTMLDivElement | null>(null);
let renderer: WorldRenderer | null = null;
let stationInfo: StationInfo | null = null;

let unsubTransportTick: (() => void) | null = null;
let unsubMiningTick: (() => void) | null = null;

onMounted(async () => {
  stationInfo = await loadUserStation();

  renderer = new WorldRenderer();

  // Forward drag state → cursor class
  renderer.onDragStateChange = (dragging) => {
    isDragging.value = dragging;
    if (dragging) hoveringEntity.value = false;
  };

  // Hover state → cursor class
  renderer.onHoverEntityChange = (isHovering) => {
    hoveringEntity.value = isHovering;
  };

  // Asteroid clicked → select in store (closes station panel)
  renderer.onAsteroidClick = (id) => {
    stationPanelOpen.value = false;
    selectionStore.select({ type: 'asteroid', id });
  };

  // Station clicked → open station panel
  renderer.onStationClick = () => {
    selectionStore.deselect();
    stationPanelOpen.value = true;
  };

  // Empty space clicked → deselect all
  renderer.onEmptyClick = () => {
    selectionStore.deselect();
    stationPanelOpen.value = false;
  };

  // TODO: derive from station scanner building level once the building system
  // exposes it. Until then every player starts with scanner level 1 which
  // reveals hidden_level 0–1 asteroids (landmark core + midRing).
  const BASE_SCANNER_STRENGTH = 1;
  await renderer.mount(worldRef.value!, stationInfo, BASE_SCANNER_STRENGTH);

  // Load mining assignment markers after renderer is ready
  await loadAssignments();

  // Load active trips (in-flight spacecraft)
  await loadTrips();

  // Refresh trips whenever the transport tick reports changes
  unsubTransportTick = wsClient.on('transport_tick_completed', () => {
    loadTrips();
  });
  // Also refresh on mining tick (miners may have started self-recall)
  unsubMiningTick = wsClient.on('mining_tick_completed', () => {
    loadTrips();
  });
});

// Sync selected asteroid → renderer selection ring
watch(
  () => selectionStore.selected,
  (entity) => {
    if (!renderer) return;
    if (entity?.type === 'asteroid') {
      renderer.setSelectedAsteroid(entity.id);
    } else {
      renderer.setSelectedAsteroid(null);
    }
  }
);

onUnmounted(() => {
  unsubTransportTick?.();
  unsubMiningTick?.();
  renderer?.destroy();
  renderer = null;
  selectionStore.deselect();
});

// ── Cursor class ──────────────────────────────────────────────────────────────
function cursorClass() {
  if (isDragging.value) return 'cursor-grabbing';
  if (hoveringEntity.value) return 'cursor-pointer';
  return 'cursor-grab';
}
</script>

<template>
  <div
    class="relative w-screen h-screen overflow-hidden bg-[#070b14] text-white select-none"
    :class="cursorClass()"
  >
    <!-- PixiJS canvas mount point -->
    <div ref="worldRef" class="absolute inset-0" />

    <!-- Top HUD -->
    <TopHud />

    <!-- Station Panel -->
    <transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="translate-y-full"
      enter-to-class="translate-y-0"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-from-class="translate-y-0"
      leave-to-class="translate-y-full"
    >
      <StationPanel
        v-if="stationPanelOpen && stationId"
        :station-id="stationId"
        :station-name="stationName"
        @close="stationPanelOpen = false"
      />
    </transition>

    <!-- Asteroid Panel -->
    <transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="translate-y-full"
      enter-to-class="translate-y-0"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-from-class="translate-y-0"
      leave-to-class="translate-y-full"
    >
      <AsteroidPanel
        v-if="selectionStore.selected?.type === 'asteroid'"
        :asteroid-id="selectionStore.selected.id"
        :station-id="stationId"
        @close="
          () => {
            selectionStore.deselect();
            loadAssignments();
          }
        "
        @refresh="loadAssignments"
      />
    </transition>
  </div>
</template>
