# Implementierungsplan: Forschungsbaum als Progressionssystem

Grundlage ist der freigegebene Entwurf (Version 2, Artifact „Research Tree“). Dieser Plan ersetzt die
heutige Stationsforschung vollständig. Er beschreibt Entscheidungen, betroffene Dateien, Tests und
Reihenfolge. Nach der Umsetzung wird er durch `docs/research.md` ersetzt und gelöscht.

## 1. Zielbild in einem Absatz

Forschung gilt für den ganzen Account, hat Stufen und Voraussetzungen und kostet Hydrogenium, ab Tier 3
Kyber und ab Tier 5 Astatine. Es läuft eine Forschung gleichzeitig, Research Network gibt einen
zweiten Slot. Das Laboratory gibt die Tiers frei, begrenzt jede Forschungsstufe auf seine Stufe und
verkürzt die Forschungszeit. Schiffe und Verteidigung werden nicht erforscht. Sie werden frei, wenn
Forschungs- und Gebäudestufen erreicht sind. Fähigkeiten öffnen Systeme: Kyber und Astatine sichtbar
und abbaubar, Expeditionen, Kolonien, Bau- und Forschungs-Slots, Signaturen anrückender Flotten sowie
automatisches Umleiten und Zuweisen von Minern. Die Ansicht ist ein Graph mit Detailpanel.

## 2. Entscheidungen

### 2.1 Bereits mit dir entschieden (aus dem Entwurf)

- Account-weit, ein Slot, zweiter Slot über Research Network (T4, Lab 10).
- Tier-Gates: T1 Lab 1, T2 Lab 3, T3 Lab 5 und Spectral, T4 Lab 8, T5 Lab 11 und Deep Spectral.
- Kosten und Dauer je Tier wie im Entwurf, pro Stufe ×1,5, Kosten auf 10 gerundet.
- 22 Forschungen in vier Ästen, Unlock-Tabelle für 15 Schiffe und Verteidigungen. Mole und Armor
  Plating sind ab Start frei.
- Weapons, Armor und Shields je +5 % pro Stufe.
- Kyber erst nach Spectral, Astatine erst nach Deep Spectral, serverseitig gefiltert.
- Kolonien und Expeditionen hängen am Baum.
- Bestehende Spielstände werden zurückgesetzt.

### 2.2 Neu entschieden beim Kartieren (mit Begründung)

| #   | Thema                     | Entscheidung                                                                                                                                                                                                                                            | Warum                                                                                                        |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| E1  | Laboratory-Kosten         | Lab kostet Carbon, Titanium und ab L2 Hydrogenium. Kyber kommt erst ab L5 dazu, Astatine ab L9. Heute kostet das Lab ab L2 Kyber und ab L5 Astatine.                                                                                                    | Sonst Sackgasse: Lab 3 braucht Kyber, Kyber braucht Spectral, Spectral braucht Lab 3.                        |
| E2  | Welche Gebäudestufe zählt | Lab-Gate, Lab-Deckel, Lab-Zeitbonus und Gebäudevoraussetzungen von Forschungen (z. B. Scanner 3) nutzen die **höchste Stufe** über alle aktiven Stationen. Unlocks von Schiffen und Verteidigung nutzen die Stufe **der bauenden Station**.             | Forschung ist account-weit, Bauen passiert an einer Station.                                                 |
| E3  | Wer zahlt                 | Beim Start wählt der Spieler die zahlende Station (Standard: aktive Station).                                                                                                                                                                           | Ressourcen bleiben stationsgebunden, wie bisher.                                                             |
| E4  | Sichtbarkeit pro Ader     | Gefiltert wird pro Ader, nicht pro Asteroid. Ein Asteroid ohne sichtbare Ader fehlt für diesen Spieler ganz, auch als unscannter Punkt. Die angezeigte Hauptressource ist die erste sichtbare Ader.                                                     | Asteroiden haben 1 bis 3 Adern. Seltene Adern liegen oft als Neben- oder Spurenader auf normalen Asteroiden. |
| E5  | Abbau versteckter Adern   | Miner bauen nur sichtbare Ressourcen ab. Ein Auftrag endet, wenn die sichtbaren Adern leer sind. Der Asteroid wird erst gelöscht, wenn alle Adern leer sind.                                                                                            | Sonst holt sich ein Spieler Kyber ohne Forschung, oder Miner pendeln leer.                                   |
| E6  | Lager, Beute, Trümmer     | Der Filter gilt nur für Asteroidenadern. Kyber im Lager, aus Beute oder aus Trümmerfeldern bleibt sichtbar.                                                                                                                                             | Das sind eigene oder offen sichtbare Güter, keine Lagerstätten-Info.                                         |
| E7  | Bau-Slots                 | Gebäude und Verteidigung teilen sich die Bau-Slots einer Station. Basis 1, Parallel Construction +1 pro Stufe (max. 3). **Heute gibt es keine Grenze.**                                                                                                 | So im Entwurf; die Grenze ist neu und bremst spürbar (siehe 2.3).                                            |
| E8  | Produktions-Slots Werft   | Eine Bauschlange pro Station statt einer pro Schiffstyp. Slots (1, 2 ab Shipyard 5, 3 ab Shipyard 10) bauen so viele Schiffe gleichzeitig: Dauer = ⌈Menge / Slots⌉ × Bauzeit × Bonus. **Heute laufen verschiedene Typen parallel.**                     | Ohne Schemaänderung, gut erklärbar.                                                                          |
| E9  | Kampfboni                 | Weapons erhöht den Angriff eigener Schiffe. Armor erhöht die Verteidigung eigener Schiffe, als Verteidiger und beim Verlustwert des Angreifers. Shields erhöht den Verteidigungswert der Station. Weapons wirkt **nicht** auf die Stationsverteidigung. | Die Stationsverteidigung hat im Kampfmodell keinen Angriffswert. Sie zählt nur als Verteidigungskraft.       |
| E10 | Cargo                     | Cargo Compression wirkt auf Mining, Salvage und Kampfbeute.                                                                                                                                                                                             | Ein Wert für Laderaum, überall gleich.                                                                       |
| E11 | Ion Propulsion            | Wirkt auf alle Flüge: Dauer ÷ (1 + 0,05 × Stufe).                                                                                                                                                                                                       | Wie heute Vector Navigation.                                                                                 |
| E12 | Kolonien                  | Stationslimit = 1 + Colony Logistics + Frontier Charter. Missionen im Flug zählen mit. **Ohne Forschung keine Kolonie.**                                                                                                                                | So im Entwurf; das Mitzählen schließt die heutige Lücke für parallele Kolonisierungen.                       |
| E13 | Expeditionen              | Brauchen Long-Range Survey. Gleichzeitige Expeditionen: 1 + Frontier Charter, gezählt pro Account.                                                                                                                                                      | So im Entwurf.                                                                                               |
| E14 | Autonomous Mining Fleet   | Ereignisgesteuert, kein Tick: Neu gebaute Miner und Miner ohne neues Ziel nach Rerouting werden zugewiesen. Manuell zurückgerufene Miner bleiben frei.                                                                                                  | Kämpft nicht gegen den Spieler; kein Schalter und keine neue Spalte nötig.                                   |
| E15 | Deep Core Drilling        | Lieferung = abgebaute Menge × (1 + 0,06 × Stufe), der Asteroid verliert nur die abgebaute Menge. Der Bonus steckt schon im Frachtmanifest.                                                                                                              | Offene Frage aus dem Entwurf; die Alternative (+6 % Abbaurate) ist ein Einzeiler.                            |
| E16 | Zerstörung, Neustart      | Forschung bleibt bei Stationsverlust und Neustart erhalten.                                                                                                                                                                                             | Account-Fortschritt, wie OGame.                                                                              |
| E17 | Research-Event            | `research_completed` gilt für den Account (`stationId` null) und kommt neu auch per WebSocket. Der Start sendet `resources_updated`.                                                                                                                    | Ersetzt das 5-Sekunden-Polling.                                                                              |
| E18 | Ort der Regeln            | Alle Formeln, Voraussetzungen und Modifikatoren stehen pur in `game-config`. API, Bots, Playtest und Frontend nutzen dieselben Funktionen.                                                                                                              | Heute stehen die Multiplikatoren an etwa zehn Stellen doppelt (Bots, Asteroid-Detail, Preview).              |
| E19 | Reset                     | Die Migration löscht `station_research`. Welt und Konten werden im Dev- und Playtest-Setup neu aufgesetzt (Datenbank-Volume neu). Die Migration selbst leert keine Spielerdaten.                                                                        | Migrationen laufen bei jedem API-Start; ein TRUNCATE darin ist zu gefährlich.                                |

### 2.3 Spürbare Änderungen am Bestand (bitte bestätigen)

1. **Bau-Slots (E7):** Heute laufen alle 6 Gebäude und 4 Verteidigungen gleichzeitig. Danach läuft
   eines, bis Parallel Construction erforscht ist (T3, Core 6). Das ist die größte Bremse im Plan.
   Construction Robotics (−3 % pro Stufe) gleicht teilweise aus. Playtest-Ziele werden neu kalibriert.
2. **Werft (E8):** Moles und Merlins bauen nicht mehr parallel, bis Shipyard 5.
3. **Kolonien (E12):** Erst ab T3. Expeditionen erst ab T2 (offene Frage aus dem Entwurf).
4. **Kyber-Kosten früher Gebäude:** Core L5, Hangar L5, Titan, Reclaimer, Ares und Guardian Cannon L5
   kosten Kyber und setzen damit Spectral voraus. Das ist gewollt: Spectral ist die Brücke ins
   Midgame. Der Plan prüft im Playtest, ob Kyber für Spieler in Astatine-Sektoren erreichbar ist.

## 3. Datenmodell und Migration

**Neue Tabelle `user_research`** (`apps/api/src/lib/db/schema/user-research.ts`). Sie folgt dem Muster
von `station_buildings`: eine Zeile pro Forschung, Stufe und laufendes Ende.

| Spalte           | Typ                    | Bemerkung                                |
| ---------------- | ---------------------- | ---------------------------------------- |
| `id`             | uuid PK                | aus `context.nextId('user-research')`    |
| `user_id`        | uuid FK users, cascade |                                          |
| `technology_key` | varchar(64)            |                                          |
| `level`          | smallint not null, 0   | erreichte Stufe                          |
| `completes_at`   | timestamptz null       | gesetzt, solange die nächste Stufe läuft |
| `started_at`     | timestamptz null       | für Fortschrittsbalken                   |
| `updated_at`     | timestamptz            |                                          |

- Unique `(user_id, technology_key)` und ein Partial Index auf `completes_at WHERE completes_at IS NOT NULL`.
- Zeilen werden beim ersten Start angelegt (`insert … on conflict do nothing`), kein Seeding pro Konto.
- Migration `0014_user_research_tree.sql`: Tabelle anlegen, `station_research` droppen.
- Eintrag in `migrations/meta/_journal.json`, idx 14, `when` gleich vorheriger Wert plus 3.600.000.
- Schema-Export: `schema/user-research.ts` neu, `schema/station-research.ts` löschen, beides in
  `schema/index.ts` nachziehen.
- Repository `repositories/user-research.ts` ersetzt `repositories/station-research.ts`:
  - `listUserResearch(userId)`
  - `listUserResearchByUsers(userIds)` für Ranking, Bots und Playtest
  - `findUserResearchForUpdate`
  - `upsertResearchStart`
  - `countActiveResearch`
  - `listDueResearch`
  - `completeResearchLevel`: `UPDATE level = level + 1, completes_at = NULL WHERE id AND completes_at <= now RETURNING`, idempotent wie bei Gebäuden.
- Nötig, aber ohne neue Tabelle:
  - `countActiveStationsByUser` plus Kolonisierungen im Flug: neue Repository-Funktion `countStationsAndColonizationsByUser`.
  - `countActiveExpeditionsByUser`.
  - Bau-Slot-Zählung: `count(station_buildings WHERE station_id AND upgrade_ends_at IS NOT NULL)`.
  - Asteroid-Abfragen bekommen einen Parameter `resourceKeys: ResourceKey[]` (Filter, keine Regel im Repository).

## 4. game-config (Phase 1)

Neue oder geänderte Dateien in `packages/game-config/src`:

### 4.1 `research.ts` (neu geschrieben)

```ts
type ResearchLane = 'extraction' | 'sensors' | 'engineering' | 'military';
type ResearchKind = 'stat' | 'capability';
interface Requirements {
  research?: Partial<Record<ResearchKey, number>>;
  buildings?: Partial<Record<BuildingKey, number>>;
}
interface ResearchDefinition {
  key: ResearchKey;
  name: string;
  description: string;
  lane: ResearchLane;
  tier: 1 | 2 | 3 | 4 | 5;
  kind: ResearchKind;
  maxLevel: number;
  requirements: Requirements; // für Stufe 1
  levelRequirements?: Record<number, Requirements>; // nur Parallel Construction: Stufe 2 braucht Core 12
}
```

- `RESEARCH_TIERS`: Lab-Gate, Pflichtforschung (Spectral, Deep Spectral), Basiskosten und Dauer je Tier.
- `calculateResearchCost(key, level)`: Basis × 1,5^(level−1), auf 10 gerundet.
- `calculateResearchDuration(key, level, labLevel)`: Minuten × 1,5^(level−1) × (1 − (labLevel−1) × 2 %), in Sekunden.
- `type ResearchLevels = Partial<Record<ResearchKey, number>>`.
- `researchBlockers(key, levels, buildingLevels)` gibt eine geordnete Liste fehlender Bedingungen
  zurück, für API, Bots und UI gleich:
  - `maxed`
  - `tier_gate` (Lab-Stufe oder Pflichtforschung)
  - `lab_cap` (nächste Stufe größer als Lab-Stufe)
  - `research` (Voraussetzung mit Ist- und Soll-Stufe)
  - `building` (Gebäude mit Ist- und Soll-Stufe)

### 4.2 `research-effects.ts` (neu)

`researchModifiers(levels): ResearchModifiers` ist die einzige Stelle mit Effektformeln:

| Feld                                          | Formel                                                                      | Quelle                |
| --------------------------------------------- | --------------------------------------------------------------------------- | --------------------- |
| `miningRate`                                  | 1 + 0,05 × L                                                                | extraction_algorithms |
| `cargo`                                       | 1 + 0,05 × L                                                                | cargo_compression     |
| `yield`                                       | 1 + 0,06 × L                                                                | deep_core_drilling    |
| `speed`                                       | 1 + 0,05 × L                                                                | ion_propulsion        |
| `scannerRange`                                | 1 + 0,05 × L                                                                | sensor_arrays         |
| `constructionBonus`                           | 3 × L (Prozentpunkte)                                                       | construction_robotics |
| `shipBuildBonus`                              | 4 × L (Prozentpunkte)                                                       | fabrication_lines     |
| `buildingCost`                                | 1 − 0,04 × L                                                                | nanite_assembly       |
| `attack`                                      | 1 + 0,05 × L                                                                | weapons               |
| `shipDefense`                                 | 1 + 0,05 × L                                                                | armor                 |
| `stationDefense`                              | 1 + 0,05 × L                                                                | shields               |
| `crew`                                        | 1 + 0,05 × L                                                                | fleet_coordination    |
| `researchSlots`                               | 1 + L                                                                       | research_network      |
| `buildSlots`                                  | 1 + L                                                                       | parallel_construction |
| `stationLimit`                                | 1 + L(colony_logistics) + L(frontier_charter)                               |                       |
| `expeditionLimit`                             | 1 + L(frontier_charter)                                                     |                       |
| `canExplore`                                  | L ≥ 1                                                                       | long_range_survey     |
| `visibleResources`                            | Carbon, Titanium, Hydrogenium, Kyber ab Spectral, Astatine ab Deep Spectral |                       |
| `signature`, `autoReroute`, `autonomousFleet` | L ≥ 1                                                                       | jeweilige Fähigkeit   |

Hilfsfunktion `applyBuildingCostDiscount(costs, modifiers)`, die auf 10 rundet.

### 4.3 Unlocks statt `SHIPYARD_UNLOCKS`

- `spacecrafts.ts` und `defense.ts` bekommen je Eintrag `requirements: Requirements` laut Tabelle im
  Entwurf. Mole und Armor Plating haben leere Voraussetzungen.
- `unlockBlockers(requirements, levels, stationBuildingLevels)` nutzt dieselbe Prüfung wie
  `researchBlockers`.
- `unlocksByBuildingLevel(buildingKey): Record<number, string[]>` wird aus den Daten berechnet:
  - Shipyard: Schiffe
  - Core: Verteidigung und Parallel Construction
  - Laboratory: „Tier N“ und Research Network
  - Scanner: Spectral, Signature, Deep Spectral

  Das füllt das bestehende `unlockMilestones` jetzt für alle Gebäude.

- `SHIPYARD_UNLOCKS` und der Effekt `spacecraft_unlock` entfallen.

### 4.4 `buildings.ts`

- Laboratory:
  - Effekt `research_capacity` wird `research_speed` = (L−1) × 2.
  - Kosten nach E1: Carbon 200, Titanium 150, Hydrogenium 80 ab L2, Kyber 30 ab L5, Astatine 15 ab L9. Werte werden im Playtest kalibriert.
- Shipyard:
  - Effekt `spacecraft_unlock` wird `production_slots` (1/2/3).
  - `spacecraft_production_bonus` bleibt bei L × 3.
- `calculateProductionSlots(shipyardLevel)`.
- Core bleibt bei `construction_speed` (L−1) × 2.

### 4.5 `influence.ts`

`calculateInfluence({ levels, research: ResearchLevels, spacecrafts })`. Forschung zählt mit der
Summe der Kosten aller erreichten Stufen / 100.

### 4.6 Exporte und Shared Types

- `index.ts`: neue Exporte, alte (`SHIPYARD_UNLOCKS`, `getResearchDefinition` alt) entfernen.
- `packages/shared/src/research.ts` neu:
  - `ResearchState { slots, active[], highestLab, technologies[] }`
  - pro Technologie: Level, maxLevel, `next { costs, durationSeconds }`, `blockers[]`, `completesAt`, `startedAt`
- `packages/shared/src/building.ts`: Effekttypen `research_speed` und `production_slots` statt
  `research_capacity` und `spacecraft_unlock`.
- `packages/shared/src/realtime.ts`: `research_completed: { technologyKey; newLevel }`.
- Spacecraft- und Defense-DTOs bekommen `requirements` und `blockers`.

### 4.7 Tests Phase 1 (Unit)

`apps/api/test/unit/research-tree.test.ts`:

- Datenintegrität: Alle referenzierten Schlüssel existieren. Keine Zyklen. Jede Voraussetzung hat
  höchstens das Tier des Knotens. Jeder Ast hat T5.
- Kosten und Dauer an Stichstufen. Tier-Gate und Lab-Deckel in `researchBlockers`.
- **Keine Sackgasse:** Für jede Kostenstufe von Gebäude, Verteidigung, Schiff und Forschung gilt:
  Braucht sie Kyber oder Astatine, dann ist die passende Spectral-Forschung mit niedrigeren
  Gebäudestufen erreichbar. Der Test fängt E1 und spätere Balance-Fehler.
- `researchModifiers` an Stichstufen. `unlocksByBuildingLevel('shipyard')` stimmt mit der Tabelle.

Anpassen: `influence.test.ts`, `station-capacity.test.ts` (Warehouse-Test mit neuen Lab-Kosten).

## 5. Forschungsdienst und API (Phase 2)

Der Ordner `apps/api/src/services/research/` bleibt Layer 1.

- `getResearchState(userId)`: Levels, aktive Forschungen, höchste Lab-Stufe über aktive Stationen,
  Blocker pro Knoten (via `researchBlockers`).
- `startResearch(userId, stationId, key, context)` in einer Transaktion:
  1. `findUserForUpdate(userId)`. Dieser Lock serialisiert alle Forschungsstarts eines Accounts.
  2. `findOwnedStationForUpdate(stationId, userId)`.
  3. Höchste Gebäudestufen der aktiven Stationen lesen.
  4. Blocker prüfen. Dazu kommen „bereits in Forschung“ und `countActiveResearch < researchSlots`.
  5. Kosten prüfen und abziehen (`deductStationResource`).
  6. `upsertResearchStart`: `completes_at = now + Dauer`, `started_at = now`.
  7. `resources_updated` senden.
  - Fehlertexte für die UI: „No free research slot“, „Requires Laboratory 5“, „Requires Weapons 3“.
  - Die Lock-Reihenfolge user → station gegen bestehende Pfade prüfen (World Missions nutzen einen
    Advisory Lock pro User).
- `completeDueResearchDetailed(now)`: `listDueResearch`, dann pro Zeile `completeResearchLevel`.
  - Event `research_completed`, `eventId = research_completed:<id>:<newLevel>`, `occurredAt = completesAt`.
  - Danach WebSocket `research_completed` an den User.
  - In `simulation.ts` wie die anderen Phasen in try/catch einbetten (heute fehlt das).
- `getResearchModifiers(userId, db)` und `getStationResearchModifiers(stationId, db)` (Join über
  Stationsbesitzer). Sie ersetzen alle Funktionen in `effects.ts`; die Datei schrumpft auf diese zwei.
- `lib/completion-events.ts`: `CompletionEventBase.stationId` wird `string | null`.
  `ResearchCompletedEvent` bekommt `technologyKey` und `newLevel`. Das Logbuch kann Einträge ohne
  Station schon schreiben (`logbook_entries.station_id` ist nullable). Text: „Research completed:
  Weapons 3“.
- Routen. Account-Routen liegen bei `/me`, wie `trips` und `combats`:
  - `routes/me/research/get-research.ts` → `GET /api/me/research`
  - `routes/me/research/_technologyKey/post-research.ts` → `POST /api/me/research/:technologyKey`, Body `{ stationId }`, Antwort 202
  - `routes/stations/_stationId/research/*` löschen.
- `combat/destruction.ts:220`: Löschen der Forschung entfernen.
- Ranking: `getRanking` lädt `listUserResearchByUsers` und gibt die Levels an `calculateInfluence`.

**Tests Phase 2** (`apps/api/test/integration/research.behavior.test.ts`):

- Start zieht Kosten bei der gewählten Station ab. Ein zweiter Start ohne freien Slot schlägt fehl.
  Zwei gleichzeitige Starts ergeben genau einen Erfolg.
- Tier-Gate, Lab-Deckel und Voraussetzungen werden abgelehnt.
- Fertigstellung ist idempotent: Zweimal claimen ergibt eine Stufe, ein Logbucheintrag, ein Event.
- Research Network gibt einen zweiten Slot.
- Forschung überlebt die Zerstörung einer Station.

Umstellen: `write-concurrency` (248–325), `playtest-events` (86), `virtual-economy-time` (146–213),
`ranking.api` (77), `virtual-world-tick` (Phasenliste).

## 6. Effekte im Spiel (Phase 3)

Jede Stelle bekommt Modifikatoren aus `getStationResearchModifiers` bzw. `getResearchModifiers`
statt der alten Ja/Nein-Abfragen.

| Bereich               | Stelle                                                                                     | Änderung                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mining-Ankunft        | `transport/trip-handlers.ts:64–84`                                                         | Cargo × `cargo`, Abbauzeit mit `miningRate`, Rückflug mit `speed`. Manifest × `yield` (E15).                                                                                  |
| Mining-Rückkehr       | `trip-handlers.ts:185–216`                                                                 | Nächster Flug mit `speed`.                                                                                                                                                    |
| Zuweisung             | `mining/assignment.ts:109,124`                                                             | Erster Flug mit `speed`.                                                                                                                                                      |
| Vorschau              | `mining/preview.ts:65–68`                                                                  | Rate, Cargo, Speed und Yield aus Modifikatoren; das Inline-`/0.9` entfällt.                                                                                                   |
| Asteroid-Detail       | `map/asteroid.ts:124–142`                                                                  | Modifikatoren über Repository und game-config, da `map` research nicht importieren darf (gleicher Layer).                                                                     |
| Kampf                 | `combat/combat.ts:193,299–346,486`                                                         | Flugzeit mit `speed`. Angriff × `attack`. Schiffsverteidigung × `shipDefense` (Verteidiger und Verlustwert des Angreifers). Stationswert × `stationDefense`. Beute × `cargo`. |
| Salvage               | `combat/salvage.ts:207,247,275`                                                            | `speed`, `cargo`.                                                                                                                                                             |
| Missionen             | `missions/world-mission.ts:96,110,130,148,209,316,407`                                     | Reise- und Anzeigezeiten mit `speed`.                                                                                                                                         |
| Gebäude, Verteidigung | `station/buildings.ts:134–143`, `station/defense.ts:167–176`                               | `applyConstructionSpeed(coreLevel, constructionBonus, …)`: Core-Bonus + Robotics, Multiplikator mindestens 0,25. Gebäudekosten × `buildingCost`.                              |
| Schiffsbau            | `station/spacecraft.ts:240–262`                                                            | Bonus = Shipyard × 3 + `shipBuildBonus`, Slots und eine Schlange pro Station (E8). `findLatestBuildOrderEnd` wird pro Station abgefragt.                                      |
| Hangar                | `station/spacecraft.ts:143,212–226`                                                        | `floor(calculateHangarCapacity(L) × crew)`.                                                                                                                                   |
| Scanner-Reichweite    | `map/scanner-visibility.ts:31–43` (`getUserScannerCoverages`), `station/station.ts:96,136` | Reichweite × `scannerRange`; Modifikatoren über Repository, wie beim Asteroid-Detail.                                                                                         |
| Gebäudeanzeige        | `station/buildings.ts:83`                                                                  | Kosten mit Rabatt, `unlockMilestones` für alle Gebäude.                                                                                                                       |

**Tests Phase 3:** Die bisherige Multiplikator-Prüfung (`write-concurrency.behavior.test.ts:276`)
wird zu einem Test mit gesetzten Stufen: Abbaurate, Cargo, Yield, Flugzeit, Bauzeit, Schiffsbauzeit,
Hangar, Kosten. Ein Kampftest mit Weapons, Armor und Shields. `mining-trip.behavior.test.ts:574`
anpassen.

## 7. Unlocks und Slots (Phase 4)

- `station/spacecraft.ts`:
  - `getStationSpacecrafts` liefert **alle** Schiffe mit `requirements` und `blockers`. Bisher wurden
    gesperrte herausgefiltert, die Konfiguration ist aber öffentlich.
  - `buildSpacecrafts` lehnt mit „Requires Weapons 2 and Shipyard 3“ ab.
- `station/defense.ts`: `startDefenseUpgrade` prüft `unlockBlockers` nur für Stufe 0 → 1. Die DTOs
  bekommen Blocker.
- Bau-Slots: `startBuildingUpgrade` und `startDefenseUpgrade` zählen laufende Upgrades der Station
  unter dem bestehenden Station-Lock gegen `buildSlots`. Fehlertext: „No free build slot“.
- **Tests:**
  - Schiffbau ohne Voraussetzung abgelehnt, mit Voraussetzung erlaubt.
  - Verteidigung analog.
  - Zweites Upgrade bei einem Slot abgelehnt, mit Parallel Construction erlaubt; das gilt auch bei
    zwei gleichzeitigen Requests.
  - Produktionsslots ändern die Dauer korrekt.
  - `write-concurrency:229` (Titan bei Shipyard 5) umschreiben.

## 8. Sichtbarkeit und Fähigkeiten (Phase 5)

### 8.1 Kyber und Astatine (E4 bis E6)

Die Filterliste kommt aus `researchModifiers(levels).visibleResources`. Das Repository bekommt nur den
Parameter `resourceKeys`.

- `repositories/asteroids.ts`:
  - `listAsteroidSummariesInChunks`: Anzeige-Hauptressource ist die erste sichtbare Ader nach Rang,
    `remainingFraction` zählt nur sichtbare Adern. Asteroiden ohne sichtbare Ader fallen weg.
  - `listAsteroidVeins`, `sumAsteroidRemainingAmount`, `listAsteroidVeinsForUpdate`,
    `listStationAssignmentsWithAsteroid` und `listAsteroidVeinsInChunks` bekommen denselben Filter.
- `map/asteroid.ts` `getAsteroidById`: 404, wenn keine Ader sichtbar ist.
- `mining/preview.ts`: Restmenge nur über sichtbare Adern.
- `mining/assignment.ts`:
  - Zuweisung ablehnen, wenn keine Ader sichtbar ist.
  - `getStationMiningAssignments` gefiltert. Das schließt nebenbei die heutige Lücke ohne Scanner-Prüfung.
- `mining/claim.ts` `claimMiningCargo(…, resourceKeys)`: proportional nur aus erlaubten Adern.
- `transport/trip-handlers.ts:153`:
  - Erschöpft heißt: erlaubte Adern leer.
  - Löschen des Asteroiden nur, wenn alle Adern leer sind und keine Aufträge bestehen.
- Bots: `goal-loader.ts:218–232` filtert `visibleAsteroids` mit derselben Liste.
- Doku `scanner-visibility.md` und `mining-loop.md` anpassen. Dabei die falschen Reichweitenwerte
  (2.000/9.000 statt 1.000/8.000) und das nicht existierende `assertPointVisible` korrigieren.

### 8.2 Signature Analysis

- `combat/combat.ts:69–97` `toReport`: Die Zusammensetzung ist sichtbar, wenn der Betrachter
  Verteidiger mit `signature` ist.
- `getUserCombatReports` lädt die Modifikatoren des Betrachters einmal.
- Bots sehen dasselbe über `goal-loader.ts:206`.
- `DefenseTab.vue:171` zeigt die Zusammensetzung statt „composition unknown“.

### 8.3 Expeditionen und Kolonien (E12, E13)

- `missions/world-mission.ts` `startExpedition` (nach dem User-Lock, Zeile 191):
  - ohne `canExplore` → „Requires Long-Range Survey“
  - Limit über `countActiveExpeditionsByUser` (traveling, returning) → „Expedition limit reached (1/1)“
- `startColonization` (nach Zeile 290):
  - `countStationsAndColonizationsByUser` gegen `stationLimit` → „Colony limit reached: research Colony Logistics“
  - Der bestehende User-Lock schützt vor parallelen Starts.
- `getFrontierTargets` liefert neu:
  - `expeditions { active, limit, canExplore }`
  - `colonization { cost, stations, limit }`

  Das Frontend rechnet die Kolonie-Kosten dann nicht mehr selbst. Die heutige Abweichung bei mehr als
  32 Sektoren verschwindet.

### 8.4 Autonomous Rerouting und Mining Fleet (E14)

- Mining (Layer 3) bekommt `selectMiningTarget(stationId, resourceKey | null, coverages, visibleResources)`:
  - nächster sichtbarer Asteroid mit Restmenge der Ressource
  - ohne Ressource: bester erwarteter Ertrag pro Stunde (Formel aus `estimateMiningCycle`)
  - Gleichstand nach Distanz, dann nach id (deterministisch)

  Die Bots ersetzen ihr `selectBestAsteroid` durch diese Funktion.

- Rerouting greift im Erschöpft-Zweig in `trip-handlers.ts:155–181`. Mit `autoReroute` wird ein neuer
  Auftrag für dieselben Miner zur gleichen Ressource angelegt, in derselben Transaktion, über die
  bestehende interne Funktion aus `createAsteroidAssignment`. Logbuch: „Miners rerouted to …“.
- Mining Fleet:
  - Nach der Bau-Fertigstellung von Minern (`simulation.ts:155–203`) und wenn Rerouting kein Ziel
    gleicher Ressource findet, wird mit `autonomousFleet` das beste Ziel gewählt.
  - Expeditions- und Salvage-Rückkehr bleiben manuell (ponytail: später, falls im Playtest Leerlauf
    auffällt).

### 8.5 Tests Phase 5

- Ein Spieler ohne Spectral sieht die Kyber-Ader nicht: nicht in Chunk, Detail, Preview oder
  Assignment. Ein reiner Kyber-Asteroid fehlt ganz. Mit Spectral ist alles sichtbar.
- Abbau ohne Spectral liefert nur sichtbare Ressourcen. Der Auftrag endet, wenn nur Kyber übrig ist,
  und der Asteroid bleibt erhalten.
- Signature: Der Verteidiger sieht die Zusammensetzung nur mit der Forschung.
- Expedition ohne Survey abgelehnt, Limit greift. Kolonie-Limit hält auch bei zwei gleichzeitigen
  Starts.
- Rerouting wählt den nächsten Asteroiden gleicher Ressource. Fleet weist neu gebaute Miner zu.
- Yield: Lieferung > Abbau.

Anpassen: `world-mission.behavior` (114–343), `virtual-travel-time` (266),
`scanner-visibility.behavior` (251–520). Diese Tests brauchen Forschung im Fixture. Dafür kommt ein
Helfer `grantResearch(userId, levels)` in `test/helpers/fixtures.ts`.

## 9. Bots (Phase 6)

Die Bots nutzen dieselben Services. Neu ist nur ihr Entscheidungsteil.

- **State:**
  - `GoalBotState.research { levels, active, slots }` aus `listUserResearchByUsers`.
  - `StationSnapshot.research` entfällt.
  - Alle Multiplikator-Kopien (`shared.ts:241–253,309`, `military.ts:50,77`, `conflict.ts:48`,
    `salvage.ts:100`) nutzen `researchModifiers`.
- **Unlocks:**
  - `unlockedFighters`, `hasShipyardLevel`, Titan (`economy.ts:551`), Mole (`economy.ts:364,491`,
    `expansion.ts:47,76`), Collector (`salvage.ts:264`) und Fortify (`military.ts:121–155`) prüfen
    `unlockBlockers`.
  - Fehlt eine Gebäudestufe, nimmt der Bot den bestehenden Upgrade-Schritt. Fehlt Forschung, meldet
    das Ziel einen Forschungsbedarf.
- **Forschungsziel** (`goals/research.ts`, neu geschrieben):
  - Kandidaten sind die nächsten Stufen ohne Blocker.
  - Score = Profilgewicht pro Ast (Technocrat alle hoch, Industrialist Extraction und Engineering,
    Pioneer Sensors, Warlord Military) + Bedarfsbonus.
  - Den Bedarfsbonus bekommt die Forschung, die ein blockiertes Ziel freischaltet. Sie wird über
    `nextResearchStep(requirements, levels, buildings)` aufgelöst, das die Kette rückwärts bis zur
    ersten machbaren Stufe läuft.
  - Tier-Gate oder Lab-Deckel lösen ein Lab-Upgrade aus, Spectral-Voraussetzungen ein Scanner-Upgrade.
  - Die Zahlstation ist die Station mit den meisten passenden Ressourcen.
  - Goal-Ref `tech:<key>:<level>`.
- `economy.ts:128–155` (Lab als Kapazitätsengpass) entfällt. `RESEARCH_LAB_CAPACITY_PER_LEVEL` entfällt.
- **Expansion:** Explore- und Colony-Kandidaten prüfen `canExplore`, Expeditionslimit und
  Stationslimit. Sonst entsteht Forschungsbedarf.
- **Intents** (`intent.ts`):
  - `start_research { stationId, technologyKey }` ruft den neuen Service.
  - „No free build slot“ und „No free research slot“ gelten als Warten, nicht als Fehler (Zeilen 60–77).
- **Tests:**
  - `goal-driven.test.ts`: Research-Fälle 731–1093 neu. Ein Fall „Warlord ohne Weapons 1 forscht
    Weapons, bevor er Merlins baut“.
  - `bot.behavior.test.ts` 322 und 568–691: Intent und Lebenszyklus.
  - Alle Bot-Tests mit Shipyard-Annahmen (546, 859–965).

## 10. Frontend (Phase 7)

Ohne neue Abhängigkeit: Graph mit HTML-Knoten und SVG-Kanten in einem per CSS transformierten
Container.

- **Einstieg:**
  - Button „Research“ im `TopHud.vue` neben Logbook und Ranking, mit laufender Forschung und Countdown.
  - `MapView.vue` öffnet `accountModal = 'research'`.
  - `UiModal` bekommt die Größe `full`, weil der Graph nicht in 720 px passt.
- **Station:**
  - Der Research-Tab verschwindet aus `stationSections` und `StationPanel.vue`.
  - `ResearchTab.vue` wird gelöscht.
  - Ein gespeicherter Abschnitt `research` in localStorage fällt auf `null` zurück.
- **Store:** `stores/research.ts` als `reactive`-Singleton wie `overview.ts`. Er lädt
  `GET /me/research` und aktualisiert sich bei `research_completed` und nach dem Start, ohne Polling.
- **`components/research/ResearchTree.vue`:**
  - Spalten = Tiers mit Gate-Beschriftung, Bänder = Äste.
  - Positionen aus `research-layout.ts` (Schlüssel → Spalte und Zeile, übernommen aus dem Artifact).
  - Kanten für Forschungsvoraussetzungen. Schiffs- und Verteidigungsknoten als kleine Blattknoten.
  - Knotenzustände:
    - gesperrt (gedimmt, Schloss)
    - verfügbar (cyan)
    - läuft (amber, Countdown)
    - maximal (grün)
  - Stufe als „3/10“. Fähigkeiten haben eine andere Form als Stat-Knoten.
  - Bedienung:
    - Ziehen verschiebt.
    - Rad und Pinch zoomen.
    - Buttons „+“, „−“ und „Fit“.
    - Klick oder Enter wählt aus.
  - Knoten sind `<button>` mit `aria-label` („Weapons, level 3 of 10, available“), Kanten sind
    `aria-hidden`.
- **`components/research/ResearchDetail.vue`** (rechts, auf dem Handy als Bottom Sheet):
  - Beschreibung, Effekt jetzt und nächste Stufe, Voraussetzungen mit ✓ oder ✗ und Ist-Stufe.
  - Kosten und Dauer.
  - Auswahl der zahlenden Station mit `formatShortfall`.
  - Button „Start research“ mit genauem Sperrgrund. Ist der Slot belegt, zeigt er die laufende
    Forschung samt Countdown.
  - Bei Unlock-Knoten: Werte des Schiffs oder der Verteidigung und „Build at Shipyard“.
- **Gesperrte Inhalte an Ort und Stelle:**
  - `BuildForm.vue` und `FleetTab.vue`: gesperrte Schiffe gedimmt mit Chips „Weapons 2“ und
    „Shipyard 3“. Ein Klick auf einen Forschungs-Chip öffnet den Graphen am Knoten.
  - `DefenseTab.vue` analog. Signature-Zusammensetzung (8.2).
  - `FrontierTab.vue`: Limits und Sperrgrund aus der Server-Antwort; die eigene Kostenrechnung entfällt.
  - `BuildingsTab.vue` und `BuildingLevelsModal.vue`: `unlockMilestones` für alle Gebäude. Hinweis in
    Zeile 166 und den `ponytail:`-Kommentar in `BuildingsTab.vue:65` (Grid-Tech) aktualisieren.
- **Übersicht:**
  - `stores/overview.ts` Operations bekommen die Art `research` (eigene Punktfarbe); ein Klick öffnet
    die Forschungsansicht.
  - `stationQueue` zählt Forschung nicht, weil sie account-weit ist.
  - Kyber- und Astatine-Zeilen in der Ressourcenleiste erscheinen erst, wenn sie sichtbar oder
    vorhanden sind.
- **Texte:** `format.ts` mit „Research time“ (−x %) und „Production slots“; `research_capacity` und
  `spacecraft_unlock` entfallen. `LogbookTab.vue:19` und `RankingTab.vue:28` prüfen.
- **Prüfung im Browser** mit dem Testkonto:
  - Graph auf Desktop und 375 px.
  - Forschung starten, Countdown, Abschluss per WebSocket.
  - Gesperrtes Schiff.
  - Kyber-Asteroid erscheint nach Spectral.

## 11. Playtest und Kalibrierung (Phase 8)

- `tools/playtest/snapshot-loader.ts` (43–46, 215–225, 319–327, 383, 398–403):
  - Forschung pro User.
  - `completedResearch` wird zu `researchLevels` (Summe der Stufen).
  - `activeResearch` pro Account.
- `invariant-queries.ts:183–197`: Überfällige Forschung aus `user_research`.
- `collector.ts:135`, `aliases.ts:9`, `aggregator.ts:417,503`, `metrics.ts:37`,
  `softlock-analyzer.ts:449–470`: auf Levels umstellen.
- Neuer Meilenstein `spectralAnalysis` (Zeit bis Kyber), weil Spectral die Brücke ist.
- `scripts/test-playtest-e2e.mjs`:
  - Research-Szenario bleibt (T1 dauert 10 Minuten).
  - Exploration-Szenario: Zeitfenster nach Messung verlängern, weil Expeditionen T2 brauchen.
  - Build-Szenario: neu prüfen, wegen eines Bau-Slots und einer Werftschlange.
- Kalibrierung mit `npm run playtest:baseline`. Zielwerte und Stellschrauben:
  - Erste Forschung < 1 h
  - Spectral 6–12 h
  - Erste Expedition < 12 h
  - Erste Kolonie 1–2 Tage
  - Kein Softlock, Kyber für jedes Profil erreichbar

  Gestellt werden nur Tier-Kosten, Tier-Dauern, Lab-Kosten und die Bau-Slot-Basis.

## 12. Doku (Phase 8)

- Neu `docs/research.md`: Baum, Formeln, Gates, Unlocks, Gebäuderollen. Danach diesen Plan löschen.
- Anpassen:
  - `bot-system.md` (18–19, 38–73, 106–119)
  - `station-destruction.md` (42, 111–113)
  - `ui-principles.md` (59–75, 116)
  - `world-generation.md` (60–80, 126–128)
  - `scanner-visibility.md`
  - `mining-loop.md` (Zeilen 3–5 gelten nur ohne Fähigkeiten)
  - `station-capacities.md` (Bau-, Produktions- und Crew-Slots)
  - `README.md`
  - `apps/api/src/services/README.md:45`

## 13. Reihenfolge, Commits, Prüfung

Branch `feat/research-tree` vom aktuellen Stand. `feat/ui-situation-overview` vorher als PR mergen
oder als Basis nehmen. Jede Phase endet mit grünem `npm run check` und den genannten Tests und ist ein
eigener Commit.

| Phase | Inhalt                                                                   | Prüfung                                |
| ----- | ------------------------------------------------------------------------ | -------------------------------------- |
| 1     | game-config, Shared Types, Unit-Tests                                    | `npm run check`, `npm run test:unit`   |
| 2     | Schema, Migration, Service, Routen, Events, Ranking                      | Integration Research und Ranking       |
| 3     | Effekte                                                                  | Integration Effekte und Kampf          |
| 4     | Unlocks, Bau- und Produktions-Slots                                      | Integration Unlocks und Slots          |
| 5     | Sichtbarkeit, Signature, Expedition und Kolonie, Rerouting, Fleet, Yield | Integration Sichtbarkeit und Missionen |
| 6     | Bots                                                                     | Unit Goal-Driven, Integration Bot      |
| 7     | Frontend                                                                 | `npm run check`, Browser               |
| 8     | Playtest, Kalibrierung, Doku                                             | `npm run verify`                       |

Damit `npm run check` ab Phase 2 grün bleibt, werden die alten Bot- und Frontend-Aufrufe in derselben
Phase minimal umgestellt: Der Bot ruft den neuen Service mit der alten Bewertungslogik, das Frontend
verliert den Research-Tab. Erst Phase 6 und 7 bauen das Verhalten aus. Zwischen Phase 2 und 7 gibt es
keine Forschungs-UI.

## 14. Abbrechen (Nachtrag)

Mit einem Bau-Slot kostet ein Verklicken viel Zeit. Deshalb lassen sich laufende Gebäude- und
Verteidigungs-Upgrades sowie laufende Forschung abbrechen.

- `DELETE /api/stations/:stationId/buildings/:buildingKey/upgrade`, analog für Verteidigung, und
  `DELETE /api/me/research/:technologyKey`.
- Unter demselben Lock wie der Start: `upgrade_ends_at` bzw. `completes_at` auf NULL setzen, nur wenn
  noch nicht fällig. Ein bereits fälliger Auftrag wird nicht mehr abgebrochen.
- Volle Rückerstattung der Kosten der Zielstufe an die Station (bei Forschung an die zahlende Station,
  dafür neue Spalte `user_research.paid_by_station_id`), begrenzt durch den Lagerplatz wie Lieferungen.
- Der Abschluss-Claim prüft `upgrade_ends_at <= now`, ein Abbruch und ein Abschluss können sich daher
  nicht beide durchsetzen.
- UI: Button „Cancel“ an laufenden Upgrades und an der laufenden Forschung, mit Bestätigung.
- Test: Abbruch gibt Kosten zurück und den Slot frei; Abbruch nach Fälligkeit wird abgelehnt.

## 15. Entschieden (ehemals offen)

Alle offenen Punkte wie vorgeschlagen: Expeditionen ab T2, Deep Core Drilling als Yield, Fleet
Coordination über Crew-Slots, Bau-Slots Basis 1, Weapons nicht auf die Stationsverteidigung.
