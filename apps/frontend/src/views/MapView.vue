<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onUnmounted, useTemplateRef } from 'vue';
import TopHud from '../components/TopHud.vue';
import StationPanel from '../components/StationPanel.vue';
import TargetStationPanel from '../components/TargetStationPanel.vue';
import AsteroidPanel from '../components/AsteroidPanel.vue';
import DebrisPanel from '../components/DebrisPanel.vue';
import SituationPanel from '../components/SituationPanel.vue';
import UiModal from '../components/UiModal.vue';
import LogbookTab from '../components/LogbookTab.vue';
import RankingTab from '../components/RankingTab.vue';
import { stationSections, useOverviewStore, type StationSection } from '../stores/overview.js';
import { apiClient, apiErrorMessage } from '../lib/api-client';
import { wsClient } from '../lib/ws-client';
import { debounced } from '../lib/debounce';
import { useAuthStore } from '../stores/auth.js';
import { WorldRenderer } from '../lib/world/WorldRenderer.js';
import type { StationInfo, AssignedAsteroid } from '../lib/world/WorldRenderer.js';
import type { ActiveMovement } from '../lib/world/TripLayer.js';
import type {
  DebrisField,
  Station,
  VisibleStation,
  VisibleWorldMovement,
} from '@orions-frontier/shared';

type SelectedEntity =
  | { type: 'asteroid'; id: string }
  | { type: 'station'; station: VisibleStation }
  | { type: 'debris'; field: DebrisField };
const selectedEntity = ref<SelectedEntity | null>(null);
const deselect = () => (selectedEntity.value = null);
const auth = useAuthStore();
const canBypassScanner = computed(() => auth.user?.role === 'admin');
const scannerBypass = ref(localStorage.getItem('dev_scanner_bypass') === 'true');

const stationId = ref<string | null>(null);
const stationName = ref<string | undefined>(undefined);
const stationIntegrity = ref<number | undefined>(undefined);
const stationPanelOpen = ref(false);
const stationSection = ref<StationSection>('buildings');
const accountModal = ref<'logbook' | 'ranking' | null>(null);
const overview = useOverviewStore();
let stopOverview: (() => void) | null = null;
const OPEN_SECTION_KEY = 'open_station_section';
const isDragging = ref(false);
const hoveringEntity = ref(false);
const needsStation = ref(false);
const stationNameInput = ref('Frontier Station');
const stationCreationError = ref<string | null>(null);
const creatingStation = ref(false);
let ownStations: StationInfo[] = [];

async function loadUserStation(): Promise<StationInfo | null> {
  try {
    const response = await apiClient.get<Station[]>('/stations');
    ownStations = response.map((station) => ({
      id: station.id,
      x: station.x,
      y: station.y,
      name: station.name,
      scannerRange: station.scannerRange,
      visualProfile: station.visualProfile,
    }));
    const preferredId = localStorage.getItem('active_station_id');
    const first = response.find((station) => station.id === preferredId) ?? response[0];
    if (first) {
      stationId.value = first.id;
      stationName.value = first.name;
      stationIntegrity.value = first.integrity;
      return {
        id: first.id,
        x: first.x,
        y: first.y,
        name: first.name,
        scannerRange: first.scannerRange,
        visualProfile: first.visualProfile,
      };
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

async function loadTrips(): Promise<void> {
  if (!renderer) return;
  try {
    const range = renderer.getVisibleChunkRange();
    const response = await apiClient.get<VisibleWorldMovement[]>('/world/trips', {
      params: {
        minChunkX: range.minChunkX,
        maxChunkX: range.maxChunkX,
        minChunkY: range.minChunkY,
        maxChunkY: range.maxChunkY,
        scannerBypass: scannerBypass.value,
      },
    });
    renderer.setActiveTrips(
      response.map((movement): ActiveMovement =>
        movement.kind === 'own_trip'
          ? {
              kind: 'own_trip',
              id: movement.id,
              fromX: movement.fromX,
              fromY: movement.fromY,
              toX: movement.toX,
              toY: movement.toY,
              departedAt: new Date(movement.departedAt).getTime(),
              arrivesAt: new Date(movement.arrivesAt).getTime(),
              purpose: movement.purpose,
              groupSize: movement.groupSize,
              miningStartedAt: movement.miningStartedAt
                ? new Date(movement.miningStartedAt).getTime()
                : undefined,
            }
          : {
              ...movement,
              observedAt: new Date(movement.observedAt).getTime(),
            }
      )
    );
  } catch {
    // non-fatal
  }
}

async function loadAssignments(): Promise<void> {
  if (!renderer || !stationId.value) return;
  try {
    const response = await apiClient.get<{
      assignments: {
        asteroidId: string;
        asteroidX: number;
        asteroidY: number;
        asteroidSize: string;
      }[];
    }>(`/stations/${stationId.value}/mining-assignments`);
    const raw = response.assignments;
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
// Trips settle one event each; reload once per burst instead of once per trip.
const scheduleMiningRefresh = debounced(refreshMiningState, 500);
const scheduleChunkRefresh = debounced(() => renderer?.refreshVisibleChunks(), 1000);

function closeAsteroidPanel() {
  deselect();
  scheduleMiningRefresh();
}

function onMiningChanged() {
  scheduleMiningRefresh();
  void overview.refreshTrips();
  if (stationId.value) void overview.refreshStation(stationId.value);
}

/** Opens a station's panel; another own station becomes active first (reload, as on the map). */
function openStation(id: string, section: StationSection | null) {
  if (id !== stationId.value) {
    localStorage.setItem('active_station_id', id);
    if (section) localStorage.setItem(OPEN_SECTION_KEY, section);
    window.location.reload();
    return;
  }
  deselect();
  if (section) stationSection.value = section;
  stationPanelOpen.value = true;
}

function openAccountModal(kind: 'logbook' | 'ranking') {
  accountModal.value = kind;
  if (kind === 'logbook') overview.markLogbookSeen();
}

const worldEl = useTemplateRef<HTMLDivElement>('worldRef');
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
  stopOverview = overview.start();
  const pendingSection = localStorage.getItem(OPEN_SECTION_KEY);
  localStorage.removeItem(OPEN_SECTION_KEY);
  const restoredSection = stationSections.find((entry) => entry === pendingSection);
  if (restoredSection) {
    stationSection.value = restoredSection;
    stationPanelOpen.value = true;
  }
  await nextTick();

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

  // Asteroid clicked → select it and close the station panel
  renderer.onAsteroidClick = (id) => {
    stationPanelOpen.value = false;
    selectedEntity.value = { type: 'asteroid', id };
  };

  // Station clicked → open station panel
  renderer.onStationClick = () => {
    deselect();
    stationPanelOpen.value = true;
  };

  renderer.onForeignStationClick = (station) => {
    if (station.isOwn) {
      openStation(station.id, null);
      return;
    }
    stationPanelOpen.value = false;
    selectedEntity.value = { type: 'station', station };
  };

  renderer.onDebrisClick = (field) => {
    stationPanelOpen.value = false;
    selectedEntity.value = { type: 'debris', field };
  };

  // Empty space clicked → deselect all
  renderer.onEmptyClick = () => {
    deselect();
    stationPanelOpen.value = false;
  };

  if (!worldEl.value) return;
  await renderer.mount(worldEl.value, stationInfo, ownStations);
  if (scannerBypass.value && canBypassScanner.value) {
    renderer.setScannerBypass(true);
  }

  // Load mining assignment markers after renderer is ready
  await loadAssignments();

  // Load active trips (in-flight spacecraft)
  await loadTrips();
  tripRefreshInterval = setInterval(() => void loadTrips(), 5_000);

  // A settled trip can change both the visible phase and the assignment.
  unsubTransportTick = wsClient.on('transport_tick_completed', () => {
    scheduleChunkRefresh();
    scheduleMiningRefresh();
  });
  unsubMiningTick = wsClient.on('mining_tick_completed', scheduleMiningRefresh);
  unsubBuildingUpgrade = wsClient.on('building_upgrade_completed', () => {
    void loadUserStation().then(() => {
      renderer?.setScannerStations(ownStations);
      renderer?.refreshVisibleChunks();
      void loadTrips();
    });
  });
});

// Sync selected asteroid → renderer selection ring
watch(selectedEntity, (entity) => {
  if (!renderer) return;
  if (entity?.type === 'asteroid') {
    renderer.setSelectedAsteroid(entity.id);
  } else {
    renderer.setSelectedAsteroid(null);
  }
});

onUnmounted(() => {
  stopOverview?.();
  scheduleMiningRefresh.cancel();
  scheduleChunkRefresh.cancel();
  unsubTransportTick?.();
  unsubMiningTick?.();
  unsubBuildingUpgrade?.();
  if (tripRefreshInterval) clearInterval(tripRefreshInterval);
  renderer?.destroy();
  renderer = null;
  deselect();
});

function cursorClass() {
  if (isDragging.value) return 'cursor-grabbing';
  if (hoveringEntity.value) return 'cursor-pointer';
  return 'cursor-grab';
}

function toggleScannerBypass() {
  scannerBypass.value = !scannerBypass.value;
  localStorage.setItem('dev_scanner_bypass', String(scannerBypass.value));
  renderer?.setScannerBypass(scannerBypass.value);
  void loadTrips();
}

watch(canBypassScanner, (allowed) => {
  if (!allowed && scannerBypass.value) toggleScannerBypass();
});
</script>

<template>
  <div
    class="relative flex h-screen w-screen flex-col overflow-hidden bg-ui-bg text-left text-sm text-ui-text select-none"
  >
    <div
      v-if="needsStation"
      class="absolute inset-0 z-30 flex items-center justify-center bg-ui-bg p-4"
    >
      <form class="ui-card w-full max-w-sm gap-4 p-6" @submit.prevent="createFirstStation">
        <h1 class="text-xl font-semibold text-ui-bright">Found your first station</h1>
        <p class="text-ui-soft">Choose a name for your foothold in the frontier.</p>
        <input
          v-model.trim="stationNameInput"
          required
          maxlength="128"
          aria-label="Station name"
          class="ui-input"
        />
        <p v-if="stationCreationError" class="text-ui-red">{{ stationCreationError }}</p>
        <button type="submit" :disabled="creatingStation" class="ui-btn ui-btn-primary">
          {{ creatingStation ? 'Founding…' : 'Found station' }}
        </button>
      </form>
    </div>

    <TopHud
      v-if="stationId"
      :station-id="stationId"
      @logbook="openAccountModal('logbook')"
      @ranking="openAccountModal('ranking')"
    />

    <div class="flex min-h-0 flex-1">
      <SituationPanel
        v-if="stationId"
        :active-station-id="stationId"
        @open="openStation"
        @logbook="openAccountModal('logbook')"
      />

      <div class="relative min-w-0 flex-1" :class="cursorClass()">
        <!-- PixiJS canvas mount point -->
        <div ref="worldRef" class="absolute inset-0" />

        <button
          v-if="stationId && canBypassScanner"
          type="button"
          class="ui-btn absolute left-3 top-3 z-10 h-8 bg-ui-panel/80 px-3 text-xs"
          :class="scannerBypass ? 'border-ui-amber text-ui-amber' : ''"
          @click.stop="toggleScannerBypass"
        >
          Scanner {{ scannerBypass ? 'off' : 'on' }}
        </button>

        <div
          v-if="stationId"
          class="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-4 rounded-md border border-ui-line bg-ui-panel/80 px-3 py-1.5 text-xs text-ui-muted backdrop-blur-sm"
        >
          <span class="flex items-center gap-1.5"
            ><i class="h-2 w-2 rounded-full bg-ui-blue" />Outbound</span
          >
          <span class="flex items-center gap-1.5"
            ><i class="h-2 w-2 animate-pulse rounded-full bg-ui-amber" />Mining</span
          >
          <span class="flex items-center gap-1.5"
            ><i class="h-2 w-2 rounded-full bg-ui-orange" />Returning</span
          >
        </div>

        <!-- Detail panels float over the map so opening one never moves it. -->
        <div class="absolute inset-y-0 right-0 z-20 flex shadow-2xl shadow-black/60">
          <StationPanel
            v-if="stationPanelOpen && stationId"
            v-model:section="stationSection"
            :station-id="stationId"
            :station-name="stationName"
            :integrity="stationIntegrity"
            @close="stationPanelOpen = false"
          />
          <TargetStationPanel
            v-else-if="selectedEntity?.type === 'station'"
            :station="selectedEntity.station"
            :origin="stationInfo"
            @close="deselect()"
          />
          <AsteroidPanel
            v-else-if="selectedEntity?.type === 'asteroid'"
            :asteroid-id="selectedEntity.id"
            :station-id="stationId"
            :scanner-bypass="scannerBypass"
            @close="closeAsteroidPanel"
            @refresh="onMiningChanged"
          />
          <DebrisPanel
            v-else-if="selectedEntity?.type === 'debris' && stationId"
            :field="selectedEntity.field"
            :station-id="stationId"
            @close="deselect()"
            @launched="onMiningChanged"
          />
        </div>
      </div>
    </div>

    <UiModal
      v-if="accountModal === 'logbook' && stationId"
      title="Logbook"
      eyebrow="Account"
      wide
      @close="accountModal = null"
    >
      <LogbookTab :station-id="stationId" />
    </UiModal>
    <UiModal
      v-if="accountModal === 'ranking'"
      title="Ranking"
      eyebrow="Server"
      wide
      @close="accountModal = null"
    >
      <RankingTab />
    </UiModal>
  </div>
</template>
