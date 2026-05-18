<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import TopHud from '../components/TopHud.vue';
import StationPanel from '../components/StationPanel.vue';
import AsteroidPanel from '../components/AsteroidPanel.vue';
import { apiClient } from '../lib/api-client';
import { WorldRenderer } from '../lib/world/index.js';
import type { StationInfo } from '../lib/world/index.js';
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

// ── PixiJS World Renderer ────────────────────────────────────────────────────

const worldRef = ref<HTMLDivElement | null>(null);
let renderer: WorldRenderer | null = null;
let stationInfo: StationInfo | null = null;

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
  },
);

onUnmounted(() => {
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
        @close="selectionStore.deselect()"
      />
    </transition>
  </div>
</template>

