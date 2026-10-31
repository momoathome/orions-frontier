<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onUnmounted, useTemplateRef } from 'vue';
import { useAuthStore } from '../auth/index.js';
import { TargetStationPanel } from '../combat/index.js';
import { LogbookTab, useLogbookStore } from '../logbook/index.js';
import { AsteroidPanel } from '../mining/index.js';
import { DebrisPanel } from '../missions/index.js';
import { SituationPanel, StationPanel, TopHud, useOverviewStore } from '../overview/index.js';
import { RankingTab } from '../ranking/index.js';
import { ResearchDetail, ResearchTree, useResearchStore } from '../research/index.js';
import {
  FoundStationForm,
  stationSections,
  useStationStore,
  type StationSection,
} from '../station/index.js';
import UiModal from '../../shared/ui/UiModal.vue';
import { apiClient } from '../../shared/api/api-client';
import { wsClient } from '../../shared/api/ws-client';
import { debounced } from '../../shared/lib/debounce';
import { live } from '../../shared/lib/live.js';
import { WorldRenderer } from './world/WorldRenderer.js';
import type { StationInfo, AssignedAsteroid } from './world/WorldRenderer.js';
import type { AsteroidHit } from './world/AsteroidLayer.js';
import type { ActiveMovement } from './world/TripLayer.js';
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
const stationPanelOpen = ref(false);
const stationSection = ref<StationSection>('buildings');
const accountModal = ref<'logbook' | 'ranking' | null>(null);
const overview = useOverviewStore();
const stopOverview = overview.start();
const stationStore = useStationStore();
const logbook = useLogbookStore();
// The research view is account-wide; chips in any panel open it through the store.
const research = useResearchStore();
const stopResearch = research.start();
const researchSelected = ref<string | null>(null);
const OPEN_SECTION_KEY = 'open_station_section';
const isDragging = ref(false);
const hoveringEntity = ref(false);
const needsStation = ref(false);
// Stations could not be loaded: not the same as having none, so never offer the founding form.
const unreachable = ref(false);
const reload = () => {
  window.location.reload();
};
// Set by onUnmounted; every await in onMounted checks it before touching the renderer.
let disposed = false;
// A call, so TypeScript does not treat the flag as constant across awaits.
const isDisposed = () => disposed;

const toStationInfo = (station: Station): StationInfo => ({
  id: station.id,
  x: station.x,
  y: station.y,
  name: station.name,
  scannerRange: station.scannerRange,
  visualProfile: station.visualProfile,
});
const ownStations = computed(() => stationStore.state.stations.map(toStationInfo));
const stationInfo = computed(
  () => stationStore.state.stations.find((station) => station.id === stationId.value) ?? null
);

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

/** Draws the active station's mining routes from the station store. */
function drawAssignments(): void {
  if (!renderer || !stationId.value) return;
  const rows = stationStore.state.details[stationId.value]?.assignments ?? [];
  // One marker per asteroid; several assignment rows can share it.
  const asteroids = new Map<string, AssignedAsteroid>();
  for (const row of rows) {
    asteroids.set(row.asteroidId, {
      asteroidId: row.asteroidId,
      x: row.asteroidX,
      y: row.asteroidY,
      size: row.asteroidSize,
    });
  }
  renderer.setAssignedAsteroids([...asteroids.values()]);
}
watch(
  () => (stationId.value ? stationStore.state.details[stationId.value]?.assignments : undefined),
  drawAssignments
);

// Scanner upgrades and new colonies change the scanned area.
watch(
  () => ownStations.value.map((s) => `${s.id}:${s.x}:${s.y}:${s.scannerRange}`).join(),
  () => {
    if (!renderer) return;
    renderer.setScannerStations(ownStations.value);
    renderer.refreshVisibleChunks();
    void loadTrips();
  }
);

// Trips settle one event each; reload once per burst instead of once per trip.
const scheduleMiningRefresh = debounced(loadTrips, 500);
const scheduleChunkRefresh = debounced(() => renderer?.refreshVisibleChunks(), 1000);

function closeAsteroidPanel() {
  deselect();
  scheduleMiningRefresh();
}

function onMiningChanged() {
  scheduleMiningRefresh();
  void overview.refreshTrips();
  if (stationId.value) void stationStore.refreshStation(stationId.value);
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

function openFromResearch(section: StationSection) {
  research.closeView();
  if (stationId.value) openStation(stationId.value, section);
}

const NEAREST_ASTEROIDS = 10;
const asteroidList = ref<AsteroidHit[] | null>(null);
const distanceTo = (asteroid: AsteroidHit) =>
  stationInfo.value
    ? Math.round(Math.hypot(asteroid.x - stationInfo.value.x, asteroid.y - stationInfo.value.y))
    : 0;

/** Lists the nearest loaded asteroids as buttons, so mining works without the canvas. */
function toggleAsteroidList() {
  const origin = stationInfo.value;
  asteroidList.value =
    asteroidList.value || !renderer || !origin
      ? null
      : renderer.nearestAsteroids(origin.x, origin.y, NEAREST_ASTEROIDS);
}

function selectAsteroid(id: string) {
  asteroidList.value = null;
  stationPanelOpen.value = false;
  selectedEntity.value = { type: 'asteroid', id };
}

function openAccountModal(kind: 'logbook' | 'ranking') {
  accountModal.value = kind;
  if (kind === 'logbook') logbook.markLogbookSeen();
}

const worldEl = useTemplateRef<HTMLDivElement>('worldRef');
/** Set once mounted; `world` is the instance to destroy, also while it still mounts. */
let renderer: WorldRenderer | null = null;
let world: WorldRenderer | null = null;

let tripRefreshInterval: ReturnType<typeof setInterval> | null = null;
// Registered at once so an unmount during the bootstrap below still removes them.
const unsubscribers = [
  // A settled trip can change both the visible phase and the assignment.
  wsClient.on('transport_tick_completed', () => {
    scheduleChunkRefresh();
    scheduleMiningRefresh();
  }),
  wsClient.on('mining_tick_completed', scheduleMiningRefresh),
  // Chunks or trips that failed to load while offline are never retried on their own.
  wsClient.onReconnected(() => {
    scheduleChunkRefresh();
    scheduleMiningRefresh();
  }),
];

// A destroyed station drops out of the list; reload to pick another one or found a new one.
watch(
  () => stationStore.state.stations.map((station) => station.id).join(),
  () => {
    if (!stationId.value || stationStore.state.stations.some((s) => s.id === stationId.value)) {
      return;
    }
    localStorage.removeItem('active_station_id');
    window.location.reload();
  }
);

onMounted(async () => {
  await stationStore.stationsLoaded();
  if (isDisposed()) return;
  const preferredId = localStorage.getItem('active_station_id');
  const active =
    stationStore.state.stations.find((station) => station.id === preferredId) ??
    stationStore.state.stations[0];
  if (!active) {
    if (live.online) needsStation.value = true;
    else unreachable.value = true;
    return;
  }
  stationId.value = active.id;
  const pendingSection = localStorage.getItem(OPEN_SECTION_KEY);
  localStorage.removeItem(OPEN_SECTION_KEY);
  const restoredSection = stationSections.find((entry) => entry === pendingSection);
  if (restoredSection) {
    stationSection.value = restoredSection;
    stationPanelOpen.value = true;
  }
  await nextTick();
  if (isDisposed() || !worldEl.value) return;

  world = new WorldRenderer();

  // Forward drag state → cursor class
  world.onDragStateChange = (dragging) => {
    isDragging.value = dragging;
    if (dragging) hoveringEntity.value = false;
  };

  // Hover state → cursor class
  world.onHoverEntityChange = (isHovering) => {
    hoveringEntity.value = isHovering;
  };

  // Asteroid clicked → select it and close the station panel
  world.onAsteroidClick = selectAsteroid;

  // Station clicked → open station panel
  world.onStationClick = () => {
    deselect();
    stationPanelOpen.value = true;
  };

  world.onForeignStationClick = (station) => {
    if (station.isOwn) {
      openStation(station.id, null);
      return;
    }
    stationPanelOpen.value = false;
    selectedEntity.value = { type: 'station', station };
  };

  world.onDebrisClick = (field) => {
    stationPanelOpen.value = false;
    selectedEntity.value = { type: 'debris', field };
  };

  // Empty space clicked → deselect all
  world.onEmptyClick = () => {
    deselect();
    stationPanelOpen.value = false;
  };

  await world.mount(worldEl.value, toStationInfo(active), ownStations.value);
  if (isDisposed()) return;
  renderer = world;
  if (scannerBypass.value && canBypassScanner.value) {
    renderer.setScannerBypass(true);
  }
  drawAssignments();
  await loadTrips();
  if (isDisposed()) return;
  tripRefreshInterval = setInterval(() => void loadTrips(), 5_000);
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
  disposed = true;
  stopOverview();
  stopResearch();
  research.closeView();
  scheduleMiningRefresh.cancel();
  scheduleChunkRefresh.cancel();
  for (const unsubscribe of unsubscribers) unsubscribe();
  if (tripRefreshInterval) clearInterval(tripRefreshInterval);
  world?.destroy();
  world = renderer = null;
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
    <FoundStationForm v-if="needsStation" />
    <div v-if="unreachable" class="m-auto flex flex-col items-center gap-3" role="alert">
      <p class="ui-error">Server unreachable.</p>
      <button type="button" class="ui-btn h-8 px-3 text-xs" @click="reload">Retry</button>
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

        <div v-if="stationId" class="absolute left-3 top-3 z-10 flex flex-col items-start gap-2">
          <div class="flex gap-2">
            <button
              type="button"
              class="ui-btn h-8 bg-ui-panel/80 px-3 text-xs"
              :aria-expanded="asteroidList !== null"
              @click.stop="toggleAsteroidList"
            >
              Nearby asteroids
            </button>
            <button
              v-if="canBypassScanner"
              type="button"
              class="ui-btn h-8 bg-ui-panel/80 px-3 text-xs"
              :class="scannerBypass ? 'border-ui-amber text-ui-amber' : ''"
              @click.stop="toggleScannerBypass"
            >
              Scanner {{ scannerBypass ? 'off' : 'on' }}
            </button>
          </div>
          <ul
            v-if="asteroidList"
            class="flex cursor-default flex-col gap-1 rounded-md border border-ui-line bg-ui-panel/90 p-2 text-xs backdrop-blur-sm"
          >
            <li v-if="asteroidList.length === 0" class="px-2 text-ui-muted">None loaded</li>
            <li v-for="asteroid in asteroidList" :key="asteroid.id">
              <button
                type="button"
                class="ui-btn h-7 w-full px-2 text-left"
                @click.stop="selectAsteroid(asteroid.id)"
              >
                Asteroid · {{ distanceTo(asteroid) }} u
              </button>
            </li>
          </ul>
        </div>

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
        <div class="absolute inset-y-0 right-0 z-20 flex cursor-default shadow-2xl shadow-black/60">
          <StationPanel
            v-if="stationPanelOpen && stationId"
            v-model:section="stationSection"
            :station-id="stationId"
            @close="stationPanelOpen = false"
          />
          <TargetStationPanel
            v-else-if="selectedEntity?.type === 'station'"
            :station="selectedEntity.station"
            :origin="stationInfo"
            @close="deselect()"
            @launched="onMiningChanged"
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
    <UiModal
      v-if="research.state.viewOpen && stationId"
      title="Research"
      eyebrow="Account"
      full
      @close="research.closeView()"
    >
      <div class="relative flex h-full">
        <ResearchTree v-model:selected="researchSelected" class="min-w-0 flex-1" />
        <!-- Side panel on desktop, bottom sheet on phones once a node is picked. -->
        <ResearchDetail
          :node-id="researchSelected"
          :station-id="stationId"
          :stations="stationStore.state.stations"
          :details="stationStore.state.details"
          class="w-[360px] shrink-0 border-l max-sm:absolute max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[65%] max-sm:w-full max-sm:rounded-t-xl max-sm:border-l-0 max-sm:border-t"
          :class="{ 'max-sm:hidden': !researchSelected }"
          @build="openFromResearch"
          @close="researchSelected = null"
        />
      </div>
    </UiModal>
  </div>
</template>
