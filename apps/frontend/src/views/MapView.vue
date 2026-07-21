<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import TopHud from '../components/TopHud.vue';
import StationPanel from '../components/StationPanel.vue';
import TargetStationPanel from '../components/TargetStationPanel.vue';
import AsteroidPanel from '../components/AsteroidPanel.vue';
import { apiClient, apiErrorMessage } from '../lib/api-client';
import { wsClient } from '../lib/ws-client';
import { WorldRenderer } from '../lib/world/WorldRenderer.js';
import type { StationInfo, AssignedAsteroid } from '../lib/world/WorldRenderer.js';
import type { ActiveTrip } from '../lib/world/TripLayer.js';
import type { VisibleWorldTrip } from '@orions-frontier/shared';
import { useSelectionStore } from '../stores/selection';

const selectionStore = useSelectionStore();

// ── Station data ─────────────────────────────────────────────────────────────

const stationId = ref<string | null>(null);
const stationName = ref<string | undefined>(undefined);
const stationPanelOpen = ref(false);
const isDragging = ref(false);
const hoveringEntity = ref(false);
const needsStation = ref(false);
const stationNameInput = ref('Frontier Station');
const stationCreationError = ref<string | null>(null);
const creatingStation = ref(false);

async function loadUserStation(): Promise<StationInfo | null> {
  try {
    const response = await apiClient.get('/stations');
    const first = response.data?.[0];
    if (first) {
      stationId.value = first.id;
      stationName.value = first.name;
      return { id: first.id, x: first.x ?? 0, y: first.y ?? 0, name: first.name };
    }
  } catch {
    // no station yet
  }
  return null;
}

async function createFirstStation() {
  creatingStation.value = true;
  stationCreationError.value = null;
  try {
    await apiClient.post('/stations', { name: stationNameInput.value });
    window.location.reload();
  } catch (error) {
    stationCreationError.value = apiErrorMessage(error, 'Station creation failed');
  } finally {
    creatingStation.value = false;
  }
}

// ── Active trips (in-flight spacecraft) ─────────────────────────────────────

async function loadTrips(): Promise<void> {
  if (!renderer) return;
  try {
    const range = renderer.getVisibleChunkRange();
    const response = await apiClient.get<{ success: true; data: VisibleWorldTrip[] }>(
      '/world/trips',
      {
        params: {
          minChunkX: range.minChunkX,
          maxChunkX: range.maxChunkX,
          minChunkY: range.minChunkY,
          maxChunkY: range.maxChunkY,
        },
      }
    );
    renderer.setActiveTrips(
      response.data.map((trip): ActiveTrip => ({
        id: trip.id,
        fromX: trip.fromX,
        fromY: trip.fromY,
        toX: trip.toX,
        toY: trip.toY,
        departedAt: new Date(trip.departedAt).getTime(),
        arrivesAt: new Date(trip.arrivesAt).getTime(),
        purpose: trip.purpose,
        groupSize: trip.groupSize,
      }))
    );
  } catch {
    // non-fatal
  }
}

// ── Assignment markers ───────────────────────────────────────────────────

async function loadAssignments(): Promise<void> {
  if (!renderer || !stationId.value) return;
  try {
    const response = await apiClient.get(`/stations/${stationId.value}/mining-assignments`);
    const raw = (response.data?.assignments ?? []) as Array<{
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

async function refreshMiningState(): Promise<void> {
  await loadAssignments();
  await loadTrips();
}

// ── PixiJS World Renderer ────────────────────────────────────────────────────

const worldRef = ref<HTMLDivElement | null>(null);
let renderer: WorldRenderer | null = null;
let stationInfo: StationInfo | null = null;

let unsubTransportTick: (() => void) | null = null;
let unsubMiningTick: (() => void) | null = null;
let unsubBuildingUpgrade: (() => void) | null = null;
let tripRefreshInterval: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  stationInfo = await loadUserStation();
  if (!stationInfo) {
    needsStation.value = true;
    return;
  }

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

  renderer.onForeignStationClick = (station) => {
    stationPanelOpen.value = false;
    selectionStore.select({ type: 'station', station });
  };

  // Empty space clicked → deselect all
  renderer.onEmptyClick = () => {
    selectionStore.deselect();
    stationPanelOpen.value = false;
  };

  await renderer.mount(worldRef.value!, stationInfo);

  // Load mining assignment markers after renderer is ready
  await loadAssignments();

  // Load active trips (in-flight spacecraft)
  await loadTrips();
  tripRefreshInterval = setInterval(() => void loadTrips(), 5_000);

  // A settled trip can change both the visible phase and the assignment.
  unsubTransportTick = wsClient.on('transport_tick_completed', () => {
    renderer?.refreshVisibleChunks();
    void refreshMiningState();
  });
  unsubMiningTick = wsClient.on('mining_tick_completed', () => {
    void refreshMiningState();
  });
  unsubBuildingUpgrade = wsClient.on('building_upgrade_completed', () => {
    renderer?.refreshVisibleChunks();
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
  unsubBuildingUpgrade?.();
  if (tripRefreshInterval) clearInterval(tripRefreshInterval);
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

    <div
      v-if="needsStation"
      class="absolute inset-0 z-30 flex items-center justify-center bg-[#070b14] p-4"
    >
      <form
        class="w-full max-w-sm rounded border border-cyan-500/20 bg-[#0a1120] p-6 flex flex-col gap-4"
        @submit.prevent="createFirstStation"
      >
        <h1 class="text-lg tracking-widest text-cyan-200">Found your first station</h1>
        <p class="text-sm text-white/50">Choose a name for your foothold in the frontier.</p>
        <input
          v-model.trim="stationNameInput"
          required
          maxlength="128"
          class="rounded border border-white/10 bg-white/5 px-3 py-2"
        />
        <p v-if="stationCreationError" class="text-sm text-red-300">{{ stationCreationError }}</p>
        <button
          type="submit"
          :disabled="creatingStation"
          class="rounded border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-cyan-200 disabled:opacity-50"
        >
          {{ creatingStation ? 'Founding…' : 'Found station' }}
        </button>
      </form>
    </div>

    <!-- Top HUD -->
    <TopHud v-if="stationId" />

    <div
      v-if="stationId"
      class="absolute top-12 right-4 z-10 flex items-center gap-3 rounded border border-white/8 bg-[#080d18]/75 px-2.5 py-1.5 text-[8px] uppercase tracking-wider text-white/45 backdrop-blur-sm pointer-events-none"
    >
      <span class="flex items-center gap-1.5"
        ><i class="w-1.5 h-1.5 rounded-full bg-[#44aaff]" />Hinflug</span
      >
      <span class="flex items-center gap-1.5"
        ><i class="w-1.5 h-1.5 rounded-full bg-[#ffcc44] animate-pulse" />Abbau</span
      >
      <span class="flex items-center gap-1.5"
        ><i class="w-1.5 h-1.5 rounded-full bg-[#ff8a22]" />Rückflug</span
      >
    </div>

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

    <!-- Foreign station target panel -->
    <transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="translate-y-full"
      enter-to-class="translate-y-0"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-from-class="translate-y-0"
      leave-to-class="translate-y-full"
    >
      <TargetStationPanel
        v-if="selectionStore.selected?.type === 'station'"
        :station="selectionStore.selected.station"
        :origin="stationInfo"
        @close="selectionStore.deselect()"
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
