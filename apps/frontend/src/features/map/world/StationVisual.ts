import { Container, Graphics } from 'pixi.js';
import type { StationVisualProfile, StationVisualTier } from '@orions-frontier/shared';

type OwnerType = 'player' | 'bot';

export interface StationVisualModel {
  id: string;
  x: number;
  y: number;
  ownerType: OwnerType;
  isOwn: boolean;
  visualProfile: StationVisualProfile;
}

export interface StationVisual {
  container: Container;
  radius: number;
  animate: (timeMs: number, zoom: number) => void;
}

interface FlightVisual {
  graphic: Graphics;
  orbitRadius: number;
  yScale: number;
  speed: number;
  offset: number;
  pathPhase: number;
  xFrequency: number;
  yFrequency: number;
}

interface GuardianVisual {
  turret: Container;
  baseAngle: number;
  phase: number;
}

const CORE_RADIUS = [22, 34, 48, 64] as const;

const STATION_COLORS = {
  darkest: 0x070b12,
  shadow: 0x0d141e,
  hull: 0x18222e,
  hullLight: 0x293746,
  panel: 0x344454,
  edge: 0x778899,
  detail: 0xa7b2bd,
} as const;

const OWNER_COLORS = {
  own: 0x44c7df,
  bot: 0x69c6a0,
  neutral: 0xd2b36c,
} as const;

const ACCENT_COLORS = {
  active: 0x55c9db,
  warning: 0xd69a52,
  scanner: 0x68c3ad,
  military: 0xc67a62,
} as const;

const LINE_WIDTH = {
  silhouette: 2.5,
  structure: 1.4,
  detail: 0.75,
} as const;

const LINE_ALPHA = {
  silhouette: 0.7,
  structure: 0.42,
  detail: 0.2,
} as const;

/**
 * Formen-Legende für alle folgenden Zeichenfunktionen:
 *
 * - Der Stationsmittelpunkt liegt bei (0, 0); +x zeigt nach rechts, +y nach unten.
 * - `circle` erzeugt Scheiben, Ringe, Leuchten oder Knoten; erst `fill` bzw. `stroke` macht
 *   den zuvor beschriebenen Kreis sichtbar.
 * - `arc` zeichnet nur einen Kreisbogen und wird für Panzersegmente, Funkwellen und Glanzkanten
 *   verwendet.
 * - `rect`/`roundRect` erzeugen technische Körper wie Buchten, Pads, Container und Pods.
 * - `moveTo` + `lineTo` erzeugt Streben, Masten, Rohre, Speichen oder feine Details.
 * - Mehrere Formen im selben `Graphics`-Objekt bilden gemeinsam eine Baugruppe. Später zum
 *   `Container` hinzugefügte Baugruppen liegen visuell vor den früher hinzugefügten.
 * - Dunkle, leicht versetzte Formen sind Schlagschatten; helle Linien oben oder links simulieren
 *   einfallendes Licht. Besitzer- und Akzentfarben markieren Zugehörigkeit bzw. Aktivität.
 */

const ownerColor = (model: StationVisualModel) =>
  model.isOwn
    ? OWNER_COLORS.own
    : model.ownerType === 'bot'
      ? OWNER_COLORS.bot
      : OWNER_COLORS.neutral;

const hashNumber = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
};

export const stationVisualRadius = (profile: StationVisualProfile): number => {
  const core = CORE_RADIUS[profile.scaleTier];
  const moduleReach = Math.max(
    24,
    profile.modules.hangar * 18 + 20,
    profile.modules.scanner * 18 + 24,
    profile.modules.shipyard * 17 + 22,
    profile.modules.laboratory * 13 + 14,
    profile.modules.warehouse * 12 + 16,
    profile.defense.armor_plating * 9 + 18,
    profile.defense.guardian_cannon * 19 + 24,
    profile.defense.defense_drones > 0 ? profile.defense.defense_drones * 14 + 60 : 0,
    // Mines orbit at core + 78 + tier·18, wobble ±5 and a 4.8 halo: see addMinefield.
    profile.defense.minefield > 0 ? profile.defense.minefield * 18 + 88 : 0
  );
  return core + moduleReach;
};

/**
 * Setzt die komplette Station schichtweise zusammen: Schatten und Außenringe bilden den
 * Hintergrund, angebundene Module liegen dahinter, der runde Kern und seine Aufbauten davor.
 * Scannerwellen, Minen und Drohnen werden zuletzt gezeichnet, weil sie die Station umgeben.
 * Der aus der Stations-ID erzeugte `variation`-Wert variiert Seiten, Winkel und Details
 * deterministisch, ohne die dargestellten Ausbaustufen zu verändern.
 */
export function createStationVisual(model: StationVisualModel): StationVisual {
  const profile = model.visualProfile;
  const owner = ownerColor(model);
  const coreRadius = CORE_RADIUS[profile.scaleTier];
  const radius = stationVisualRadius(profile);
  const variation = hashNumber(model.id);
  const warehouseSide: -1 | 1 = variation % 2 === 0 ? -1 : 1;
  const serviceAntennaSide: -1 | 1 = warehouseSide === -1 ? 1 : -1;
  const container = new Container();
  container.position.set(model.x, model.y);

  addOuterShadow(container, coreRadius);
  addStructureRing(container, coreRadius, owner);
  addArmorPlating(container, profile.defense.armor_plating, coreRadius, owner, variation);
  addRingLights(container, coreRadius, owner, variation);
  addConnectors(container, profile, coreRadius, warehouseSide, variation);

  addHangars(container, profile.modules.hangar, coreRadius, variation % 4);
  addScannerBase(container, profile.modules.scanner, coreRadius);
  const shipyardSignals = addShipyard(container, profile.modules.shipyard, coreRadius);
  addWarehouse(container, profile.modules.warehouse, coreRadius, warehouseSide);
  if (variation % 3 !== 0) addServiceAntenna(container, coreRadius, serviceAntennaSide, variation);

  addCore(container, coreRadius, owner, model.isOwn, profile.modules.core);
  const guardian = addGuardianCannon(
    container,
    profile.defense.guardian_cannon,
    coreRadius,
    owner,
    variation
  );
  addHullPanelVariation(container, coreRadius, variation);
  if (variation % 4 === 1) addMaintenancePods(container, coreRadius, serviceAntennaSide, variation);
  if (variation % 5 === 2) addAuxSensorDish(container, coreRadius, warehouseSide, variation);
  const laboratorySignals = addLaboratory(container, profile.modules.laboratory, coreRadius);

  const scannerSignals = addScannerSignals(container, profile.modules.scanner, coreRadius);
  addMinefield(container, profile.defense.minefield, coreRadius, variation);
  const defenseDrones = addDefenseDrones(
    container,
    profile.defense.defense_drones,
    coreRadius,
    owner,
    variation
  );

  return {
    container,
    radius,
    animate(timeMs) {
      // Bewegt nur Aktivitätsmerkmale: Geschütz schwenkt, Statuslichter pulsieren,
      // Scannerbögen wachsen und verblassen, Drohnen folgen unregelmäßigen elliptischen Bahnen.
      if (guardian) {
        guardian.turret.rotation =
          guardian.baseAngle + Math.sin(timeMs / 4200 + guardian.phase) * 0.16;
      }
      for (const [i, signal] of laboratorySignals.entries()) {
        const phase = (timeMs + variation * 37 + i * 1050) % 3600;
        const pulse = phase < 320 ? Math.sin((phase / 320) * Math.PI) : 0;
        signal.alpha = 0.3 + pulse * 0.7;
      }
      for (const [i, signal] of shipyardSignals.entries()) {
        const phase = (timeMs + variation * 23 + i * 700) % 1400;
        const pulse = phase < 220 ? Math.sin((phase / 220) * Math.PI) : 0;
        signal.alpha = 0.18 + pulse * 0.82;
      }
      for (const [i, signal] of scannerSignals.entries()) {
        const phase = (timeMs / 1900 + i / scannerSignals.length) % 1;
        signal.scale.set(0.45 + phase * 1.9);
        signal.alpha = (1 - phase) * 0.5;
      }
      for (const drone of defenseDrones) {
        const angle = drone.offset + timeMs * drone.speed;
        const xWave = angle * drone.xFrequency + drone.pathPhase;
        const yWave = angle * drone.yFrequency - drone.pathPhase;
        const x = Math.cos(angle) * drone.orbitRadius + Math.sin(xWave) * drone.orbitRadius * 0.22;
        const y =
          Math.sin(angle) * drone.orbitRadius * drone.yScale +
          Math.cos(yWave) * drone.orbitRadius * 0.14;
        const direction = Math.sign(drone.speed);
        const dx =
          (-Math.sin(angle) * drone.orbitRadius +
            Math.cos(xWave) * drone.xFrequency * drone.orbitRadius * 0.22) *
          direction;
        const dy =
          (Math.cos(angle) * drone.orbitRadius * drone.yScale -
            Math.sin(yWave) * drone.yFrequency * drone.orbitRadius * 0.14) *
          direction;
        drone.graphic.position.set(x, y);
        drone.graphic.rotation = Math.atan2(dy, dx) + Math.PI / 2;
      }
    },
  };
}

/** Erzeugt eine versetzte schwarze Kreisscheibe als weichen Gesamtschatten der Station. */
function addOuterShadow(container: Container, coreRadius: number): void {
  const g = new Graphics();
  g.circle(3, 5, coreRadius + 13);
  g.fill({ color: 0x000000, alpha: 0.42 });
  container.addChild(g);
}

/**
 * Erzeugt zwei konzentrische Außenringe: einen breiten hellen Strukturkranz direkt um den Kern
 * und eine feine, halbtransparente Besitzer-Markierung etwas weiter außen.
 */
function addStructureRing(container: Container, coreRadius: number, owner: number): void {
  const g = new Graphics();
  g.circle(0, 0, coreRadius + 5);
  g.stroke({ color: STATION_COLORS.hullLight, alpha: 0.9, width: 5 });
  g.circle(0, 0, coreRadius + 8);
  g.stroke({ color: owner, alpha: 0.22, width: 1 });
  container.addChild(g);
}

/**
 * Erzeugt je nach Stufe 1, 3 oder 6 dicke Panzerbögen außerhalb des Kerns. Kürzere, dünne Bögen
 * darüber wirken wie Materialkanten; jedes dritte Segment trägt die Besitzerfarbe. Die ID-Variation
 * dreht das gesamte Segmentmuster, damit gleich ausgebaute Stationen nicht identisch aussehen.
 */
function addArmorPlating(
  container: Container,
  tier: StationVisualTier,
  coreRadius: number,
  owner: number,
  variation: number
): void {
  if (tier === 0) return;

  const g = new Graphics();
  const plateCount = tier === 1 ? 1 : tier === 2 ? 3 : 6;
  const radius = coreRadius + 12;
  const arcSize = Math.PI / (plateCount + 3);
  const offset = (variation % 9) * 0.19;

  for (let i = 0; i < plateCount; i++) {
    const angle = offset + (Math.PI * 2 * i) / plateCount;
    g.arc(0, 0, radius, angle - arcSize, angle + arcSize);
    g.stroke({
      color: i % 3 === 0 ? owner : STATION_COLORS.edge,
      alpha: i % 3 === 0 ? 0.5 : 0.62,
      width: 3.2 + tier * 0.45,
    });
    g.arc(0, 0, radius + 3.5, angle - arcSize * 0.72, angle + arcSize * 0.72);
    g.stroke({ color: STATION_COLORS.detail, alpha: 0.18, width: 0.8 });
  }

  container.addChild(g);
}

/**
 * Verteilt zwei bis vier kleine Lichtpunkte auf dem äußeren Ring. Der erste Punkt ist größer und
 * kann als gelbes Warnlicht erscheinen, alle übrigen sind dezente Positionslichter in Besitzerfarbe.
 */
function addRingLights(
  container: Container,
  coreRadius: number,
  owner: number,
  variation: number
): void {
  const g = new Graphics();
  const lightCount = 2 + (variation % 3);
  const radius = coreRadius + 8;
  const offset = (variation % 12) * 0.37;

  for (let i = 0; i < lightCount; i++) {
    const angle = offset + (Math.PI * 2 * i) / lightCount;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    g.circle(x, y, i === 0 ? 2 : 1.5);
    g.fill({
      color: i === 0 && variation % 2 === 0 ? ACCENT_COLORS.warning : owner,
      alpha: i === 0 ? 0.42 : 0.26,
    });
  }

  container.addChild(g);
}

/**
 * Legt ein bis drei kleine abgerundete Rechtecke auf die Kernhülle. Diese wechselnd hellen
 * Wartungsplatten brechen die große Kreisfläche rein optisch auf und stellen kein eigenes Modul dar.
 */
function addHullPanelVariation(container: Container, coreRadius: number, variation: number): void {
  const g = new Graphics();
  const panelCount = 1 + (variation % 3);
  const radius = coreRadius * 0.86;
  const baseAngle = (variation % 8) * 0.41;

  for (let i = 0; i < panelCount; i++) {
    const angle = baseAngle + i * 1.35;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    g.roundRect(x - 4, y - 1.5, 8, 3, 1);
    g.fill({
      color: (variation + i) % 2 === 0 ? STATION_COLORS.hullLight : STATION_COLORS.panel,
      alpha: 0.55,
    });
  }

  container.addChild(g);
}

/**
 * Zeichnet die tragenden Verbindungen vom Kern zu allen vorhandenen Außenmodulen: waagerecht zu
 * Hangars, nach oben zum Scanner, nach unten zur Werft und diagonal zum Lager. Jede Verbindung
 * besteht aus einem breiten dunklen Balken mit einer dünnen hellen Mittellinie.
 */
function addConnectors(
  container: Container,
  profile: StationVisualProfile,
  coreRadius: number,
  warehouseSide: -1 | 1,
  variation: number
): void {
  const g = new Graphics();
  if (profile.modules.hangar > 0) {
    const sides: readonly (-1 | 1)[] =
      profile.modules.hangar === 1 ? [variation % 2 === 0 ? -1 : 1] : [-1, 1];
    for (const side of sides) {
      addConnector(g, side * coreRadius * 0.7, 0, side * (coreRadius + 18), 0);
    }
  }
  if (profile.modules.scanner > 0) addConnector(g, 0, -coreRadius * 0.7, 0, -coreRadius - 22);
  if (profile.modules.shipyard > 0) {
    const extension = profile.modules.shipyard >= 2 ? 8 : 0;
    addConnector(g, 0, coreRadius * 0.7, 0, coreRadius + 24 + extension);
  }
  if (profile.modules.warehouse > 0) {
    addConnector(
      g,
      warehouseSide * coreRadius * 0.48,
      -coreRadius * 0.58,
      warehouseSide * (coreRadius * 0.78 + 8),
      -coreRadius * 0.78 - 4
    );
  }
  container.addChild(g);
}

function addConnector(g: Graphics, x1: number, y1: number, x2: number, y2: number): void {
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke({ color: STATION_COLORS.panel, alpha: 0.9, width: 5 });
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke({ color: STATION_COLORS.edge, alpha: 0.3, width: 1 });
}

/**
 * Erzeugt den zentralen runden Stationskörper von außen nach innen:
 *
 * - große Hüllenscheibe mit Kontur und, ab Kernstufe 2, außenliegenden Panzerbögen,
 * - dunkler Innenring mit Besitzerkontur,
 * - leuchtende Reaktorscheibe in der Mitte und sechs radiale Speichen,
 * - ab Stufe 2 einen Reaktorring und drei bzw. sechs leuchtende Energieknoten,
 * - auf Stufe 3 sechs kräftige Käfigsegmente um den Reaktor.
 *
 * Ein dunkler unterer Bogen und ein heller oberer Bogen geben der flachen Kreisgrafik Tiefe.
 */
function addCore(
  container: Container,
  coreRadius: number,
  color: number,
  isOwn: boolean,
  tier: StationVisualTier
): void {
  const g = new Graphics();
  g.circle(0, 0, coreRadius);
  g.fill({ color: STATION_COLORS.hull, alpha: 1 });
  g.stroke({ color: STATION_COLORS.edge, alpha: LINE_ALPHA.silhouette, width: 1.5 });

  if (tier >= 2) {
    const plateCount = tier === 2 ? 3 : 6;
    const plateRadius = coreRadius + 2;
    const plateArc = Math.PI / (plateCount + 4);
    for (let i = 0; i < plateCount; i++) {
      const angle = (Math.PI * 2 * i) / plateCount;
      g.arc(0, 0, plateRadius, angle - plateArc, angle + plateArc);
      g.stroke({ color: tier === 3 ? color : STATION_COLORS.hullLight, alpha: 0.8, width: 4 });
      g.arc(0, 0, plateRadius + 3, angle - plateArc * 0.7, angle + plateArc * 0.7);
      g.stroke({ color: STATION_COLORS.detail, alpha: 0.3, width: 0.8 });
    }
  }

  g.circle(0, 0, coreRadius * 0.78);
  g.fill({ color: STATION_COLORS.shadow, alpha: 1 });
  g.stroke({ color, alpha: 0.32, width: 1 });

  const reactorRadius = Math.max(8, coreRadius * 0.3);
  g.circle(0, 0, reactorRadius + 3);
  g.fill({ color: 0x071018, alpha: 1 });
  g.circle(0, 0, reactorRadius);
  g.fill({ color, alpha: isOwn ? 0.42 : 0.3 });

  const spokeStart = coreRadius * 0.38;
  const spokeEnd = coreRadius * 0.68;
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 * i) / 6;
    g.moveTo(Math.cos(angle) * spokeStart, Math.sin(angle) * spokeStart);
    g.lineTo(Math.cos(angle) * spokeEnd, Math.sin(angle) * spokeEnd);
  }
  g.stroke({ color: STATION_COLORS.edge, alpha: 0.3, width: 1 });

  if (tier >= 2) {
    g.circle(0, 0, reactorRadius + 5.5);
    g.stroke({ color, alpha: 0.44, width: 1.2 });

    const nodeCount = tier === 2 ? 3 : 6;
    const nodeRadius = coreRadius * 0.67;
    for (let i = 0; i < nodeCount; i++) {
      const angle = (Math.PI * 2 * i) / nodeCount;
      const x = Math.cos(angle) * nodeRadius;
      const y = Math.sin(angle) * nodeRadius;
      g.circle(x, y, tier === 3 ? 2.6 : 2.1);
      g.fill({ color, alpha: tier === 3 ? 0.78 : 0.58 });
      g.circle(x, y, tier === 3 ? 4.8 : 3.8);
    }
  }

  if (tier >= 3) {
    const cageRadius = coreRadius * 0.73;
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6;
      g.arc(0, 0, cageRadius, angle - 0.22, angle + 0.22);
      g.stroke({ color: color, alpha: 0.72, width: 3.5 });
    }
    g.circle(0, 0, reactorRadius + 8.5);
  }

  g.arc(0, 0, coreRadius * 0.9, Math.PI * 0.15, Math.PI * 0.9);
  g.stroke({ color: 0x000000, alpha: 0.35, width: 4 });
  addArcHighlight(g, 0, 0, coreRadius * 0.88);
  container.addChild(g);
}

/**
 * Erzeugt seitlich am Kern einen oder zwei längliche Hangarblöcke. Jeder Block ist ein abgerundetes
 * Rechteck mit versetztem Schatten und enthält pro Stufe eine dunkle rechteckige Flugbucht. Ein
 * schmaler gelber Streifen an der Außenkante zeigt den Aktivitätszustand jeder Bucht.
 */
function addHangars(
  container: Container,
  tier: StationVisualTier,
  coreRadius: number,
  variation: number
): void {
  if (tier === 0) return;

  const g = new Graphics();
  const bayCount = tier;
  const armLength = 18 + tier * 8;
  const bayHeight = 9 + tier * 2;
  const spacing = bayHeight + 4;
  const totalHeight = (bayCount - 1) * spacing + bayHeight + 10;
  const top = -totalHeight / 2;
  const sides: readonly (-1 | 1)[] = tier === 1 ? [variation % 2 === 0 ? -1 : 1] : [-1, 1];

  for (const side of sides) {
    const x = side > 0 ? coreRadius + 3 : -coreRadius - armLength - 3;

    g.roundRect(x + 2, top + 3, armLength, totalHeight, 3);
    g.fill({ color: STATION_COLORS.darkest, alpha: 0.8 });

    g.roundRect(x, top, armLength, totalHeight, 3);
    g.fill({ color: STATION_COLORS.hull, alpha: 1 });
    g.stroke({ color: STATION_COLORS.edge, alpha: 0.45, width: LINE_WIDTH.detail });
    addTopHighlight(g, x + 4, top + 3, armLength - 8);

    for (let i = 0; i < bayCount; i++) {
      const y = top + 5 + i * spacing;
      const active = tier === 1 || i !== variation % bayCount || side > 0;
      g.roundRect(x + 4, y, armLength - 8, bayHeight, 1.5);
      g.fill({ color: active ? 0x07090d : STATION_COLORS.shadow, alpha: 1 });

      const lightX = side > 0 ? x + 5 : x + armLength - 7;
      g.rect(lightX, y + 2, 2, bayHeight - 4);
      g.fill({ color: ACCENT_COLORS.warning, alpha: active ? 0.72 : 0.18 });
    }
  }

  container.addChild(g);
}

/**
 * Erzeugt oberhalb des Kerns den Scanner: einen schmalen, abgerundeten Mast, einen runden Sensorkopf
 * und eine horizontale Antennenstrebe. Mastlänge, Kopfgröße und Strebenbreite wachsen mit der Stufe.
 */
function addScannerBase(container: Container, tier: StationVisualTier, coreRadius: number): void {
  if (tier === 0) return;

  const g = new Graphics();
  const mastTop = -coreRadius - 16 - tier * 10;
  g.roundRect(-4, mastTop, 8, coreRadius + mastTop * -1, 3);
  g.fill({ color: STATION_COLORS.hull, alpha: 1 });
  g.stroke({ color: STATION_COLORS.edge, alpha: 0.55, width: LINE_WIDTH.structure });

  g.circle(0, mastTop - 5, 5 + tier);
  g.fill({ color: STATION_COLORS.hullLight, alpha: 1 });
  g.stroke({ color: ACCENT_COLORS.scanner, alpha: 0.75, width: 1 });

  g.moveTo(-12 - tier * 3, mastTop - 5);
  g.lineTo(12 + tier * 3, mastTop - 5);
  g.stroke({ color: STATION_COLORS.detail, alpha: 0.4, width: 1 });
  container.addChild(g);
}

/**
 * Legt am Scannerkopf mehrere offene Kreisbögen als Funkwellen an. Die Animation skaliert jeden
 * Bogen vom Kopf weg und blendet ihn aus; zeitlich versetzt entsteht ein kontinuierliches Signal.
 */
function addScannerSignals(
  container: Container,
  tier: StationVisualTier,
  coreRadius: number
): Graphics[] {
  if (tier === 0) return [];

  const signals: Graphics[] = [];
  const mastTipY = -coreRadius - 21 - tier * 10;
  for (let i = 0; i < tier + 1; i++) {
    const signal = new Graphics();
    signal.arc(0, 0, 7 + tier * 2, Math.PI * 1.16, Math.PI * 1.84);
    signal.stroke({ color: ACCENT_COLORS.scanner, alpha: 1, width: 0.9 });
    signal.position.set(0, mastTipY);
    container.addChild(signal);
    signals.push(signal);
  }
  return signals;
}

/**
 * Erzeugt im rechten oberen Bereich des Kerns eine runde Laborkuppel aus Schatten-, Gehäuse- und
 * Innenkreisen. Pro Stufe kommt darin ein kleiner türkisfarbener Messknoten hinzu, dessen Helligkeit
 * in der Animation kurz pulsiert.
 */
function addLaboratory(
  container: Container,
  tier: StationVisualTier,
  coreRadius: number
): Graphics[] {
  if (tier === 0) return [];

  const g = new Graphics();
  const x = coreRadius * 0.56;
  const y = -coreRadius * 0.6;
  const r = 5 + tier * 3;
  g.circle(x + 2, y + 3, r + 3);
  g.fill({ color: 0x000000, alpha: 0.32 });
  g.circle(x, y, r + 3);
  g.fill({ color: STATION_COLORS.darkest, alpha: 1 });
  g.circle(x, y, r);
  g.fill({ color: 0x172b36, alpha: 1 });
  g.stroke({ color: STATION_COLORS.edge, alpha: 0.55, width: 1 });
  const nodes = [
    [-0.25, -0.2],
    [0.28, 0.12],
    [-0.12, 0.3],
  ] as const;
  container.addChild(g);

  const signals: Graphics[] = [];
  for (const [nodeX, nodeY] of nodes.slice(0, tier)) {
    const signal = new Graphics();
    signal.circle(x + r * nodeX, y + r * nodeY, Math.max(1.5, r * 0.13));
    signal.fill({ color: ACCENT_COLORS.active, alpha: 1 });
    container.addChild(signal);
    signals.push(signal);
  }
  return signals;
}

/**
 * Erzeugt unterhalb des Kerns ein oder zwei rechteckige Werft-Pads. Rahmen, Innenkontur, Mittellinie
 * und Lichtleiste lesen sich als technische Bauplattform; auf Stufe 3 markieren zwei pulsierende
 * gelbe Rundlichter die äußeren Ecken.
 */
function addShipyard(
  container: Container,
  tier: StationVisualTier,
  coreRadius: number
): Graphics[] {
  if (tier === 0) return [];

  const g = new Graphics();
  const padCount = tier >= 2 ? 2 : 1;
  const padWidth = 32 + tier * 8;
  const padHeight = 20 + tier * 5;
  const gap = 7;
  const totalWidth = padCount * padWidth + (padCount - 1) * gap;
  const y = coreRadius + 16 + (tier >= 2 ? 6 : 0);

  for (let i = 0; i < padCount; i++) {
    const x = -totalWidth / 2 + i * (padWidth + gap);
    g.roundRect(x + 2, y + 3, padWidth, padHeight, 4);
    g.fill({ color: STATION_COLORS.darkest, alpha: 0.78 });

    g.roundRect(x, y, padWidth, padHeight, 4);
    g.fill({ color: STATION_COLORS.hull, alpha: 1 });
    g.stroke({ color: STATION_COLORS.edge, alpha: 0.52, width: LINE_WIDTH.detail });
    addTopHighlight(g, x + 4, y + 3, padWidth - 8);

    g.roundRect(x + 5, y + 5, padWidth - 10, padHeight - 10, 2);
    g.stroke({ color: STATION_COLORS.detail, alpha: 0.28, width: 0.7 });
    g.moveTo(x + padWidth / 2, y + 7);
    g.lineTo(x + padWidth / 2, y + padHeight - 7);
    g.stroke({ color: STATION_COLORS.detail, alpha: 0.22, width: 0.7 });

    g.rect(x + 7, y + padHeight - 5, padWidth - 14, 2);
    g.fill({ color: ACCENT_COLORS.active, alpha: i === 0 ? 0.36 : 0.22 });
  }
  container.addChild(g);

  if (tier < 3) return [];
  const signals: Graphics[] = [];
  for (const x of [-totalWidth / 2 + 5, totalWidth / 2 - 5]) {
    const signal = new Graphics();
    signal.circle(x, y + 5, 2.2);
    signal.fill({ color: ACCENT_COLORS.warning, alpha: 1 });
    signal.circle(x, y + 5, 4.5);
    signal.stroke({ color: ACCENT_COLORS.warning, alpha: 0.28, width: 0.7 });
    container.addChild(signal);
    signals.push(signal);
  }
  return signals;
}

/**
 * Erzeugt schräg oben am Kern ein schwenkbares Verteidigungsgeschütz: eine dicke Stützstrebe, einen
 * runden Turmkopf und je nach Stufe ein oder zwei lange Läufe. Dunkle breite Linien sind die Läufe,
 * schmalere orange Linien darüber deren erhitzte bzw. aktive Innenflächen.
 */
function addGuardianCannon(
  container: Container,
  tier: StationVisualTier,
  coreRadius: number,
  owner: number,
  variation: number
): GuardianVisual | null {
  if (tier === 0) return null;

  const side: -1 | 1 = variation % 2 === 0 ? -1 : 1;
  const angle = side < 0 ? Math.PI * 0.76 : Math.PI * 0.24;
  const baseX = Math.cos(angle) * coreRadius * 0.92;
  const baseY = Math.sin(angle) * coreRadius * 0.92;
  const length = 14 + tier * 6;
  const barrelCount = tier >= 3 ? 2 : 1;

  const support = new Graphics();
  support.moveTo(Math.cos(angle) * coreRadius * 0.58, Math.sin(angle) * coreRadius * 0.58);
  support.lineTo(baseX, baseY);
  support.stroke({ color: STATION_COLORS.panel, alpha: 0.85, width: 5 });
  container.addChild(support);

  const turret = new Container();
  turret.position.set(baseX, baseY);
  turret.rotation = angle;
  const g = new Graphics();
  g.circle(2, 3, 8 + tier * 2);
  g.fill({ color: 0x000000, alpha: 0.3 });
  g.circle(0, 0, 8 + tier * 2);
  g.fill({ color: STATION_COLORS.hullLight, alpha: 1 });
  g.stroke({ color: owner, alpha: 0.42, width: 1 });

  for (let i = 0; i < barrelCount; i++) {
    const spread = barrelCount === 1 ? 0 : i === 0 ? -2.2 : 2.2;
    g.moveTo(0, spread);
    g.lineTo(length, spread);
    g.stroke({ color: STATION_COLORS.darkest, alpha: 0.95, width: tier >= 2 ? 5.5 : 5 });
    g.moveTo(0, spread);
    g.lineTo(length, spread);
    g.stroke({ color: ACCENT_COLORS.military, alpha: 0.82, width: tier >= 2 ? 3 : 2.6 });
    g.circle(length, spread, 1.7);
    g.fill({ color: ACCENT_COLORS.military, alpha: 0.58 });
  }

  g.circle(-3, 0, 3 + tier);
  g.fill({ color: ACCENT_COLORS.military, alpha: 0.36 });
  turret.addChild(g);
  container.addChild(turret);
  return { turret, baseAngle: angle, phase: (variation % 17) * 0.29 };
}

/**
 * Stapelt diagonal oberhalb des Kerns zwei Reihen quadratischer Frachtcontainer auf einen dunklen
 * Sockel. Mit jeder Stufe wächst das Lager um eine Spalte; wechselnde Grautöne trennen die einzelnen
 * Boxen, ein gelber schmaler Balken dient als Statuslicht.
 */
function addWarehouse(
  container: Container,
  tier: StationVisualTier,
  coreRadius: number,
  side: -1 | 1
): void {
  if (tier === 0) return;

  const g = new Graphics();
  const block = 8 + tier * 2;
  const columns = tier + 1;
  const width = columns * block + (columns - 1) * 2;
  const height = block * 2 + 2;
  const anchorX = side * (coreRadius * 0.78 + 8);
  const startX = anchorX - (side > 0 ? 0 : width);
  const startY = -coreRadius * 0.78 - height - 4;

  g.roundRect(startX - 1, startY, width + 6, height + 7, 2);
  g.fill({ color: STATION_COLORS.darkest, alpha: 0.55 });
  g.roundRect(startX - 3, startY - 3, width + 6, height + 6, 2);
  g.fill({ color: STATION_COLORS.shadow, alpha: 0.95 });

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < columns; col++) {
      const color = (row + col) % 3 === 0 ? STATION_COLORS.panel : STATION_COLORS.hullLight;
      g.roundRect(startX + col * (block + 2), startY + row * (block + 2), block, block, 1.5);
      g.fill({ color, alpha: 0.9 });
      g.stroke({ color: STATION_COLORS.edge, alpha: LINE_ALPHA.detail, width: 0.6 });
    }
  }

  g.rect(startX + width - 4, startY + 2, 2, block - 2);
  g.fill({ color: ACCENT_COLORS.warning, alpha: 0.42 });
  container.addChild(g);
}

/**
 * Erzeugt als zufälliges Oberflächendetail einen dünnen diagonalen Antennenstab mit einem kleinen
 * türkisfarbenen Endpunkt. Die Antenne liegt auf der dem Lager gegenüberliegenden Seite.
 */
function addServiceAntenna(
  container: Container,
  coreRadius: number,
  side: -1 | 1,
  variation: number
): void {
  const g = new Graphics();
  const startAngle = side < 0 ? Math.PI * 1.22 : Math.PI * 1.78;
  const length = coreRadius + 14 + (variation % 3) * 3;
  const x1 = Math.cos(startAngle) * coreRadius * 0.9;
  const y1 = Math.sin(startAngle) * coreRadius * 0.9;
  const x2 = Math.cos(startAngle) * length;
  const y2 = Math.sin(startAngle) * length;
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke({ color: STATION_COLORS.detail, alpha: 0.42, width: 1 });
  g.circle(x2, y2, 2);
  g.fill({ color: ACCENT_COLORS.active, alpha: 0.42 });
  container.addChild(g);
}

/**
 * Erzeugt als zufälliges Oberflächendetail zwei kleine versetzte, abgerundete Wartungskapseln.
 * Jede Kapsel besitzt eine Kontur und ein schwaches gelbes Kontrolllicht.
 */
function addMaintenancePods(
  container: Container,
  coreRadius: number,
  side: -1 | 1,
  variation: number
): void {
  const g = new Graphics();
  const x = side * coreRadius * 0.74;
  const y = coreRadius * (0.48 + (variation % 2) * 0.12);

  for (let i = 0; i < 2; i++) {
    const podX = x + side * i * 7;
    const podY = y + i * 4;
    g.roundRect(podX - 3, podY - 4, 6, 8, 2);
    g.fill({ color: STATION_COLORS.shadow, alpha: 0.95 });
    g.stroke({ color: STATION_COLORS.edge, alpha: 0.35, width: 0.7 });
    g.circle(podX, podY - 1, 1);
    g.fill({ color: ACCENT_COLORS.warning, alpha: 0.32 });
  }

  container.addChild(g);
}

/**
 * Erzeugt als zufälliges Oberflächendetail einen kurzen Haltearm mit einer offenen, gebogenen
 * Sensorschüssel und einem Punkt im Brennpunkt. Die Schüssel sitzt unterhalb des Kerns.
 */
function addAuxSensorDish(
  container: Container,
  coreRadius: number,
  side: -1 | 1,
  variation: number
): void {
  const g = new Graphics();
  const angle = side < 0 ? Math.PI * 1.42 : Math.PI * 1.58;
  const radius = coreRadius + 9 + (variation % 2) * 4;
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;

  g.moveTo(Math.cos(angle) * coreRadius * 0.82, Math.sin(angle) * coreRadius * 0.82);
  g.lineTo(x, y);
  g.stroke({ color: STATION_COLORS.detail, alpha: 0.28, width: 0.8 });
  g.arc(x, y, 4, angle - 0.9, angle + 0.9);
  g.stroke({ color: ACCENT_COLORS.scanner, alpha: 0.48, width: 1 });
  g.circle(x, y, 1.3);
  g.fill({ color: STATION_COLORS.detail, alpha: 0.55 });
  container.addChild(g);
}

/**
 * Verteilt je nach Stufe 6, 9 oder 12 kleine runde Minen auf einem abgeflachten Ring weit außerhalb
 * der Station. Leicht unterschiedliche Radien vermeiden einen perfekten Kreis; einzelne Minen
 * erhalten zusätzlich einen sehr schwachen äußeren Warnring.
 */
function addMinefield(
  container: Container,
  tier: StationVisualTier,
  coreRadius: number,
  variation: number
): void {
  if (tier === 0) return;

  const g = new Graphics();
  const mineCount = 3 + tier * 3;
  const orbit = coreRadius + 78 + tier * 18;

  for (let i = 0; i < mineCount; i++) {
    const angle = (Math.PI * 2 * (i + (variation % 7) / 7)) / mineCount;
    const wobble = ((variation + i * 13) % 11) - 5;
    const x = Math.cos(angle) * (orbit + wobble);
    const y = Math.sin(angle) * (orbit + wobble) * 0.82;
    g.circle(x, y, 2.1);
    g.fill({ color: STATION_COLORS.darkest, alpha: 0.92 });
    g.stroke({ color: ACCENT_COLORS.warning, alpha: 0.38, width: 0.8 });
    if ((variation + i) % 3 === 0) {
      g.circle(x, y, 4.8);
      g.stroke({ color: ACCENT_COLORS.warning, alpha: 0.08, width: 0.6 });
    }
  }

  container.addChild(g);
}

/**
 * Erzeugt pro Stufe zwei Verteidigungsdrohnen auf unterschiedlich großen Flugbahnen. Der gemeinsame
 * Container hält sie über der Station; Form und individuelle Bahnparameter entstehen in
 * `addDefenseDrone`, die eigentliche Bewegung übernimmt `animate`.
 */
function addDefenseDrones(
  container: Container,
  tier: StationVisualTier,
  coreRadius: number,
  owner: number,
  seed: number
): FlightVisual[] {
  if (tier === 0) return [];

  const droneContainer = new Container();
  const drones: FlightVisual[] = [];
  const count = tier * 2;
  for (let i = 0; i < count; i++) {
    const drone = addDefenseDrone(
      droneContainer,
      coreRadius + 48 + tier * 8 + (i % 3) * 14,
      i,
      count,
      owner,
      seed + 43
    );
    drones.push(drone);
  }
  container.addChild(droneContainer);
  return drones;
}

/**
 * Erzeugt eine kleine rautenförmige Drohnensilhouette aus vier Liniensegmenten. Geschwindigkeit,
 * Flugrichtung, Ellipsenstauchung und Wellenfrequenzen werden deterministisch variiert, sodass die
 * Drohnen in der Animation organisch wirkende, aber reproduzierbare Schleifen fliegen.
 */
function addDefenseDrone(
  container: Container,
  orbitRadius: number,
  index: number,
  total: number,
  color: number,
  seed: number
): FlightVisual {
  const offset = (Math.PI * 2 * (index + (seed % 10) / 10)) / total;
  const direction = (seed + index) % 3 === 0 ? -1 : 1;
  const speed = direction * 0.0003 * (1 + ((seed + index) % 5) * 0.08);
  const graphic = new Graphics();
  graphic.moveTo(0, -3.2);
  graphic.lineTo(2.6, 2.4);
  graphic.lineTo(0, 1);
  graphic.lineTo(-2.6, 2.4);
  graphic.lineTo(0, -3.2);
  graphic.fill({ color, alpha: 0.82 });
  container.addChild(graphic);
  return {
    graphic,
    orbitRadius,
    yScale: 0.58 + ((seed + index) % 4) * 0.08,
    speed,
    offset,
    pathPhase: ((seed + index * 7) % 13) * 0.37,
    xFrequency: 2 + ((seed + index) % 2),
    yFrequency: 3 + ((seed + index) % 3),
  };
}

/** Zeichnet eine feine weiße Linie an die Oberkante rechteckiger Module als Lichtreflex. */
function addTopHighlight(g: Graphics, x: number, y: number, width: number): void {
  g.moveTo(x, y);
  g.lineTo(x + width, y);
  g.stroke({ color: 0xffffff, alpha: 0.12, width: 1 });
}

/** Zeichnet einen kurzen weißen Bogen links oben auf runden Modulen als Lichtreflex. */
function addArcHighlight(g: Graphics, x: number, y: number, radius: number): void {
  g.arc(x, y, radius, Math.PI * 1.08, Math.PI * 1.52);
  g.stroke({ color: 0xffffff, alpha: 0.11, width: 1 });
}
