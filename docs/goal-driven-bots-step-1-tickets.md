# Tickets für zielorientierte Bots – Schritt 1

Stand: 27. Juli 2026.

Dieses Ticketpaket konkretisiert ausschließlich
[Schritt 1: Glaubwürdige Bewohner](./goal-driven-bots-plan.md#schritt-1-glaubwürdige-bewohner).
Der beschleunigte Spieltest aus Schritt 2 ist nicht enthalten.

## Gemeinsamer Umsetzungsvertrag

Diese Regeln gelten für jedes Ticket:

- Bots rufen dieselben Domain-Services wie Spieler auf. Es gibt keine Bot-Kosten, Bot-Ressourcen,
  verkürzten Zeiten oder direkten Zustandsänderungen.
- Eine fällige Bot-Entscheidung löst höchstens eine erfolgreiche Spielaktion aus.
- Eigene Daten dürfen exakt sein. Fremde Daten dürfen nur aus der normalen öffentlichen
  Serverprojektion oder eigenen Kampfberichten stammen.
- Entscheidungen sind bei identischem Zustand deterministisch. Bei Gleichstand entscheiden stabile
  Typ- und Objektkennungen.
- Ziele, Scores und Gründe sind intern. Sie werden weder Weltkarte noch Spieler-API hinzugefügt.
- Es entstehen keine Aktionsqueue, kein Behavior Tree, kein allgemeiner Planer, kein freies
  Ziel-JSON und kein neuer Bot-Prozess.
- PostgreSQL bleibt die Wahrheit. Schemaänderungen enthalten die nächste SQL-Migration und den
  passenden Drizzle-Schemaexport.
- Vor einer Regeländerung ist nur der jeweils genannte Vertrag in `docs/` zu lesen und bei Bedarf
  zu aktualisieren.
- Nach Codeänderungen laufen `npm run check`, der kleinste genannte Test und wegen der geänderten
  Spielmechanik `npm run verify`.

Für die fünf neuen Forschungen gilt zunächst dieselbe neutrale Forschungsbaseline wie für
`automated_shipyard`: 5 Kapazitätspunkte, 120 Sekunden, 200 Carbon und 150 Titanium. Dadurch wird
die erste Bot-Auswahl vom konkreten Nutzen und nicht von unterschiedlichen Forschungspreisen
dominiert. Diese Werte sind ausdrücklich spätere Balancingwerte.

## Reihenfolge und Abhängigkeiten

| Ticket | Ergebnis                                            | Benötigt                   |
| ------ | --------------------------------------------------- | -------------------------- |
| GB-01  | Stationsübernahme und Einfluss entfernt             | –                          |
| GB-02  | Schutz junger Accounts                              | GB-01                      |
| GB-03  | Extraction Algorithms wirksam                       | –                          |
| GB-04  | Modular Cargo Frames wirksam                        | –                          |
| GB-05  | Vector Navigation wirksam                           | –                          |
| GB-06  | Combat Analytics wirksam                            | GB-01                      |
| GB-07  | Station Grid Optimization wirksam                   | –                          |
| GB-08  | Profile und minimaler Zielzustand persistent        | –                          |
| GB-09  | Öffentliche Gegneridentität und Mehrstationszustand | GB-08                      |
| GB-10  | Reine Zielbewertung und Zielbindung                 | GB-08                      |
| GB-11  | Persistenter Ziel-Lebenszyklus im Bot-Tick          | GB-09, GB-10               |
| GB-12  | Stabilisierung, Einkommen und Kapazität             | GB-11                      |
| GB-13  | Erklärbare Forschungswahl                           | GB-03 bis GB-07, GB-11     |
| GB-14  | Exploration und Kolonisation                        | GB-11, GB-12               |
| GB-15  | Befestigung und Angriffsflotte                      | GB-11                      |
| GB-16  | Feindseligkeit, Zielwahl und Reserve                | GB-02, GB-09, GB-10, GB-15 |
| GB-17  | Raid und Vergeltung                                 | GB-16                      |
| GB-18  | Bergungsentscheidung                                | GB-04, GB-05, GB-11, GB-12 |
| GB-19  | Aktivierung und Profilregression                    | alle vorherigen Tickets    |

Die Reihenfolge hält jeden Merge-Stand baubar. Bis GB-19 bleibt `economic_v1` die aktive
Produktionsstrategie; die neue Strategie wird vorher direkt durch Unit- und Verhaltenstests
ausgeführt.

## GB-01 – Stationsübernahme und Einfluss vollständig entfernen

### Konkretes Ziel

Ein Kampf kann niemals den Besitzer einer Station ändern und erzeugt keine Einflussdaten mehr.

### Feature-Beschreibung

Die bisherige Sofortübernahme wird als vollständiger vertikaler Schnitt aus Kampfabschluss, API,
Shared Contract, Frontend, Realtime und Datenbank entfernt. Beute, Verluste, Rückflug und
Trümmerfelder bleiben unverändert.

### Acceptance Criteria

- Ein gewonnener Angriff ändert `stations.user_id` nicht.
- Ein gewonnener Angriff erzeugt weiterhin begrenzte Beute und Trümmer, schreibt aber keinen
  Einfluss.
- `GET /api/stations/:stationId/influence` und
  `POST /api/stations/:stationId/takeover` existieren nicht mehr und antworten mit `404`.
- Das Zielstationspanel lädt keine Einflussdaten, zeigt keinen Kontrollfortschritt und bietet keine
  Übernahmeaktion an.
- `StationInfluence`, `influence.service.ts`, beide Routen, das Ownership-Realtime-Event und dessen
  Frontend-Listener sind entfernt.
- Eine neue SQL-Migration löscht `station_influence`; Drizzle-Schema, Schemaexport und
  Testbereinigung referenzieren die Tabelle nicht mehr.
- Der bestehende Bergungstest prüft weiterhin Beute und vollständige Bergung. Ein fokussierter
  Kampftest prüft zusätzlich den unveränderten Stationsbesitzer.
- Aktuelle Verträge und Übersichten beschreiben Einfluss und Stationsübernahme nicht mehr als
  vorhandene Mechanik.

### Nötige Umsetzungsinformationen

- Fachlicher Vertrag:
  [Keine Stationsübernahme](./goal-driven-bots-plan.md#keine-stationsübernahme).
- Zentrale Startpunkte:
  `apps/api/src/services/combat.service.ts`,
  `apps/api/src/services/influence.service.ts`,
  `apps/frontend/src/components/TargetStationPanel.vue`,
  `apps/frontend/src/views/MapView.vue`,
  `packages/shared/src/influence.ts` und
  `apps/api/src/lib/db/schema/station-influence.ts`.
- Routen werden per Dateisystem automatisch geladen. Das Löschen der beiden Routendateien entfernt
  die Endpunkte.
- Die Migration wird angehängt; `0000_initial.sql` wird nicht rückwirkend geändert.
- Relevante Tests:
  `apps/api/test/integration/combat.behavior.test.ts`,
  `apps/api/test/integration/combat.api.test.ts` und
  `apps/api/test/integration/scanner-visibility.behavior.test.ts`.
- Zu aktualisieren:
  `README.md`, `docs/implementation-plan.md` und die abgeschlossene Phase 2 in
  `docs/scanner-visibility-plan.md`.
- Nicht Teil des Tickets: Besatzung, Loyalität, Einflussersatz oder eine andere Eroberungsmechanik.

## GB-02 – Accountweiten Schutz junger Spieler umsetzen

### Konkretes Ziel

Accounts sind in ihren ersten 24 Stunden vor eingehenden Angriffen geschützt, bis sie selbst einen
gültigen Angriff starten.

### Feature-Beschreibung

Die Regel liegt ausschließlich in `startAttack` und gilt damit identisch für Menschen und Bots.
Der Schutz ist accountweit, wird durch Kolonien nicht erneuert und ist auf der Weltkarte nicht
sichtbar.

### Acceptance Criteria

- Ein Angriff auf einen Account mit `created_at + 24 Stunden > now` wird abgewiesen, solange dieser
  Account noch keinen gültigen eigenen Angriff gestartet hat.
- Die Ablehnung ist ein verständlicher Domain-Fehler, erzeugt keine Mission, sperrt keine Flotte,
  kostet keine Ressource und beendet den Schutz des Angreifers nicht.
- Nach dem erfolgreichen Start des ersten eigenen Angriffs ist der Angreifer sofort accountweit
  angreifbar.
- Nach 24 Stunden ist ein Account auch ohne eigenen Angriff angreifbar.
- Eine neu gegründete zweite Station verändert den Schutzzeitpunkt nicht.
- Mensch und Bot durchlaufen denselben Codepfad.
- Weder `VisibleStation` noch eine Kartenantwort enthält Schutzstatus oder verbleibende Dauer.
- Gleichzeitige Angriffsstarts können die Prüfung nicht durch einen Race umgehen und führen nicht
  zu einem Deadlock.

### Nötige Umsetzungsinformationen

- Fachlicher Vertrag:
  [Schutz junger Accounts](./goal-driven-bots-plan.md#schutz-junger-accounts).
- `users.createdAt` existiert bereits. Ergänzt wird nur ein nullable Zeitpunkt wie
  `attackProtectionBrokenAt`; die 24 Stunden werden aus einem kanonischen Wert in
  `packages/game-config` berechnet. Ein zweiter persistierter Ablaufzeitpunkt ist nicht nötig.
- `startAttack` kennt Angreifer- und Verteidiger-Account. Beide User-Zeilen werden innerhalb der
  bestehenden Transaktion in stabiler ID-Reihenfolge gesperrt. Erst nach allen erfolgreichen
  Prüfungen wird beim Angreifer `attackProtectionBrokenAt` gesetzt und die Mission eingefügt.
- Die Methode erhält für fokussierte Tests optional `now = new Date()`. Das ist noch keine
  allgemeine virtuelle Uhr aus Schritt 2.
- Startpunkt: `apps/api/src/services/combat.service.ts`,
  `apps/api/src/lib/db/schema/users.ts` und die nächste Migration.
- Teststartpunkt: `apps/api/test/integration/combat.behavior.test.ts`. Abzudecken sind jung,
  abgelaufen, durch eigenen Angriff beendet, zweite Station und konkurrierende Starts.
- Nicht Teil des Tickets: sichtbarer Countdown, Anfängerstatus im Frontend oder Schutz pro Station.

## GB-03 – Extraction Algorithms serverseitig wirksam machen

### Konkretes Ziel

Abgeschlossene `extraction_algorithms` erhöhen die Abbaurate der Miner dieser Station um 10 Prozent.

### Feature-Beschreibung

Die Technologie wird als einmalige Forschung ergänzt. Ihr Effekt wird bei tatsächlichem
Mining-Fortschritt sowie allen serverseitigen Vorschauen und Bot-Schätzungen derselben Station
verwendet.

### Acceptance Criteria

- `extraction_algorithms` erscheint mit der gemeinsamen Forschungsbaseline im Research State.
- Nur der Status `completed` aktiviert den Effekt; `available` und `researching` ändern nichts.
- Für Schiffe der Rolle `miner` gilt `effectiveMiningRate = baseMiningRate * 1.1`.
- Cargo, Geschwindigkeit, Kampfkraft und Bergungsschiffe bleiben unverändert.
- Tatsächliche Miningdauer, Mining-Preview, laufende Assignment-Projektion und `economic_v1`
  verwenden denselben effektiven Wert.
- Die Technologie wirkt nur auf Vorgänge der Station, an der sie abgeschlossen wurde.
- Ein Verhaltenstest vergleicht denselben Mininglauf vor und nach abgeschlossener Forschung.

### Nötige Umsetzungsinformationen

- Definition: `packages/game-config/src/research.ts`, Key `extraction_algorithms`.
- Tatsächliche Abbaudauer entsteht in
  `apps/api/src/services/transport/trip-handlers.ts`.
- Weitere Projektionen liegen in `apps/api/src/services/asteroid.service.ts`,
  `apps/api/src/routes/asteroids/_id/mining-preview/get-preview.ts` und
  `apps/api/src/services/bot/bot-state.service.ts`.
- Bestehende Prüfung wiederverwenden:
  `hasCompletedResearch` aus `apps/api/src/services/research.service.ts`.
- Kein allgemeines Modifier-System bauen. Eine kleine explizite Berechnung für diesen Effekt reicht.

## GB-04 – Modular Cargo Frames serverseitig wirksam machen

### Konkretes Ziel

Abgeschlossene `modular_cargo_frames` erhöhen die Frachtkapazität von Minern und Bergungsschiffen
dieser Station um 10 Prozent.

### Feature-Beschreibung

Die Technologie wird als einmalige Forschung ergänzt. Die erhöhte Kapazität gilt beim atomaren
Mining-Claim und beim Entnehmen aus einem Trümmerfeld sowie in den zugehörigen Vorschauen.

### Acceptance Criteria

- `modular_cargo_frames` erscheint mit der gemeinsamen Forschungsbaseline im Research State.
- Nur `completed` aktiviert `effectiveCargo = baseCargo * 1.1`.
- Der Effekt gilt ausschließlich für Rollen `miner` und `salvager`; Fighter-Beute bleibt
  unverändert.
- Mining-Claim, Bergungsentnahme, Mining-Preview, Assignment-Projektion und Bot-Schätzung verwenden
  denselben Wert.
- Lagergrenzen gelten weiterhin beim Rücktransport; überschüssige Fracht wird nicht gutgeschrieben.
- Der Effekt ist stationslokal und wird nicht auf Schiffe einer anderen eigenen Station übertragen.
- Je ein fokussierter Mining- und Bergungsfall schützt den Effekt.

### Nötige Umsetzungsinformationen

- Definition: `packages/game-config/src/research.ts`, Key `modular_cargo_frames`.
- Miningkapazität wird beim Claim in
  `apps/api/src/services/transport/trip-handlers.ts` übergeben.
- Bergungskapazität wird in `apps/api/src/services/salvage.service.ts` beim
  `resolveSalvageOutbound` berechnet.
- Vorschauen und Bot-State verwenden dieselben Startpunkte wie GB-03.
- Diskrete Ressourcenmengen werden erst an der vorhandenen Ressourcen-/Claim-Grenze gerundet; der
  1,1-Multiplikator selbst wird nicht vorzeitig gerundet.

## GB-05 – Vector Navigation auf alle neuen Reisen anwenden

### Konkretes Ziel

Abgeschlossene `vector_navigation` verkürzt jede danach erzeugte Schiffsreise dieser Station exakt
um 10 Prozent.

### Feature-Beschreibung

Die Technologie gilt für Hin- und Rückwege von Mining, Kampf, Bergung, Expedition und
Kolonisation. Bereits persistierte Reisen werden nicht nachträglich verändert.

### Acceptance Criteria

- `vector_navigation` erscheint mit der gemeinsamen Forschungsbaseline im Research State.
- Für jede neu erzeugte betroffene Reise gilt
  `effectiveDuration = baseDuration * 0.9`.
- Mining-, Kampf-, Bergungs-, Expeditions- und Kolonisationsreisen sowie ihre Rückwege verwenden die
  Regel.
- Eine Rückreise prüft die Forschung beim Erzeugen des Rückwegs; eine inzwischen abgeschlossene
  Forschung darf daher für diesen neuen Reiseabschnitt gelten.
- Bereits vorhandene `spacecraft_trips.arrives_at` werden weder migriert noch verändert.
- Frontier- und Mining-Vorschauen zeigen dieselbe verkürzte Zeit.
- Geschwindigkeit oder öffentliche Schiffskonfiguration wird nicht global verändert.
- Ein fokussierter Test deckt mindestens eine normale Hin-/Rückreise und eine Weltmission ab.

### Nötige Umsetzungsinformationen

- Definition: `packages/game-config/src/research.ts`, Key `vector_navigation`.
- Relevante Reiseerzeuger:
  `mining/assignment.service.ts`, `transport/trip-handlers.ts`, `combat.service.ts`,
  `salvage.service.ts` und `world-mission.service.ts`.
- `apps/api/src/lib/travel.ts` bleibt die reine Baseline. Eine kleine stationsbezogene Hilfsfunktion
  darf den dort berechneten Zeitpunkt mit dem expliziten Faktor 0,9 anpassen.
- `getFrontierTargets`, `getKnownSectors` und die Mining-Preview müssen denselben Effekt abbilden.
- Kein nachträglicher Tick-basierter Geschwindigkeitsbonus und kein generisches Buff-System.

## GB-06 – Combat Analytics in der Kampfauflösung anwenden

### Konkretes Ziel

Abgeschlossene `combat_analytics` erhöhen die Angriffskraft angreifender Fighter dieser Station um
10 Prozent.

### Feature-Beschreibung

Die Technologie wird bei der autoritativen Kampfauflösung auf die exakte eigene Angriffsflotte
angewendet. Sie verändert weder Verteidigung noch Beute oder statische Stationsverteidigung.

### Acceptance Criteria

- `combat_analytics` erscheint mit der gemeinsamen Forschungsbaseline im Research State.
- Nur Fighter einer Station mit abgeschlossener Forschung erhalten
  `effectiveAttack = baseAttack * 1.1`.
- Die Berechnung verwendet den Forschungsstand der `attackerStationId`.
- Defender-Fighter erhalten keinen erfundenen Angriffswert; das aktuelle Kampfsystem verwendet auf
  Verteidigerseite weiterhin Defense.
- Kampfbericht, Verluste, Beutegrenze und Trümmerlogik bleiben strukturell unverändert.
- Bot-Schätzungen der eigenen Kampfkraft verwenden später denselben effektiven Angriffswert.
- Ein Verhaltenstest zeigt einen reproduzierbaren Grenzfall, dessen Ergebnis sich durch die
  abgeschlossene Forschung ändert.

### Nötige Umsetzungsinformationen

- Definition: `packages/game-config/src/research.ts`, Key `combat_analytics`.
- Autoritativer Startpunkt: `resolveOutboundCombat` in
  `apps/api/src/services/combat.service.ts`.
- Dezimaler Angriff wird in der vorhandenen Verlustformel verwendet; nicht vor der Formel runden.
- Fachlicher Kampfkontext:
  [Konfliktverhalten](./goal-driven-bots-plan.md#konfliktverhalten).
- Stationsübernahme darf durch dieses Ticket nicht zurückkehren.

## GB-07 – Station Grid Optimization auf Upgrades anwenden

### Konkretes Ziel

Abgeschlossene `station_grid_optimization` verkürzen neue Gebäude- und
Verteidigungsupgrades derselben Station exakt um 10 Prozent.

### Feature-Beschreibung

Die Technologie wirkt bei der Erstellung eines Upgradeauftrags. Bereits laufende Arbeiten,
Forschung und Schiffsbau bleiben unverändert.

### Acceptance Criteria

- `station_grid_optimization` erscheint mit der gemeinsamen Forschungsbaseline im Research State.
- Neue normale Gebäudeupgrades und Defense-Upgrades erhalten
  `effectiveDuration = baseDuration * 0.9`.
- Nur `completed` und nur die Station mit der Forschung profitieren.
- Laufende Upgrades werden nicht neu terminiert.
- Forschungsdauer und Schiffsbauzeit ändern sich nicht; `automated_shipyard` bleibt der einzige
  Forschungsbonus auf Schiffsbau.
- Die zurückgelieferten Endzeitpunkte und die persistierten `upgrade_ends_at` stimmen überein.
- Je ein fokussierter Test deckt Gebäude- und Defense-Upgrade ab.

### Nötige Umsetzungsinformationen

- Definition: `packages/game-config/src/research.ts`, Key `station_grid_optimization`.
- Startpunkte:
  `apps/api/src/services/building.service.ts` und
  `apps/api/src/services/defense.service.ts`.
- Baselinefunktionen in `packages/game-config/src/buildings.ts` und
  `packages/game-config/src/defense.ts` bleiben unverändert.
- Der Effekt wird unmittelbar vor dem Setzen von `upgradeEndsAt` angewendet.

## GB-08 – Bot-Profile und minimalen Zielzustand persistieren

### Konkretes Ziel

Jeder Bot besitzt dauerhaft ein Spielstilprofil und genau einen kleinen, typisierten
Langfristzielzustand.

### Feature-Beschreibung

Der vorhandene Controller wird ohne neue Tabelle um Strategieversion, Profil und minimale
Zielmetadaten erweitert. Bestehende Bots werden deterministisch auf vier Profile verteilt;
`economic_v1` bleibt zunächst aktiv.

### Acceptance Criteria

- Der Controller speichert:
  `strategyVersion`, `profile`, `activeGoalType`, `activeGoalTarget`,
  `goalStartedAt`, `lastProgressAt`, den vorhandenen `nextDecisionAt`, `lastAction` und
  `lastReason`.
- `profile` ist genau einer der Werte
  `industrialist`, `pioneer`, `technocrat`, `warlord`.
- Zieltyp ist einer der elf Typen aus dem Plan. Ein ungültiger persistierter Wert wird kontrolliert
  als unbekannt behandelt und nicht ausgeführt.
- Zielreferenzen sind kurze kanonische Strings wie `station:<uuid>`, `sector:<x>:<y>`,
  `tech:<key>`, `user:<uuid>` oder `debris:<uuid>`; es gibt keine JSON-Spalte.
- Bestehende Controller erhalten per Migration eine stabile Verteilung anhand sortierter
  Bot-Benutzernamen. Neu provisionierte Bots erhalten ihr Profil deterministisch aus dem stabilen
  Sektor-/Bot-Key.
- Ein Neustart verändert das Profil oder aktive Ziel nicht.
- `economic_v1` verhält sich nach diesem Ticket unverändert.

### Nötige Umsetzungsinformationen

- Fachlicher Vertrag:
  [Langfristige Spielstile](./goal-driven-bots-plan.md#langfristige-spielstile) und
  [Fortschritt und Stillstand](./goal-driven-bots-plan.md#fortschritt-und-stillstand).
- Schema:
  `apps/api/src/lib/db/schema/bot-controllers.ts` plus nächste Migration.
- Provisionierung:
  `apps/api/src/services/bot/bot-provision.service.ts`.
- Interne Bot-Typen bleiben in `apps/api`; Ziele und Gründe sind kein Shared-/Spielervertrag.
- Die vier Kategoriegewichte werden exakt aus dem Plan übernommen.
- Teststartpunkte:
  `apps/api/test/integration/world-generation.behavior.test.ts` und
  `apps/api/test/integration/bot.behavior.test.ts`.

## GB-09 – Öffentliche Gegneridentität und Mehrstationszustand laden

### Konkretes Ziel

Die neue Bot-Strategie erhält einen vollständigen, aber regelkonformen Zustand aller eigenen
Stationen und aller öffentlich sichtbaren Chancen.

### Feature-Beschreibung

Der bisherige Ein-Stationszustand wird durch einen accountweiten Snapshot ersetzt. Eigene
Ressourcen, Schiffe, Gebäude, Forschung und Arbeit bleiben pro Station getrennt. Sichtbare fremde
Stationen erhalten eine stabile öffentliche Besitzerreferenz, damit Konfliktgeschichte
accountweit statt fälschlich pro Station geführt werden kann.

### Acceptance Criteria

- Der Snapshot enthält alle eigenen Stationen, jeweils mit Ressourcen, Gebäuden und laufenden
  Upgrades, Flotten und Bauaufträgen, Miningzustand, Forschung, Missionen und Defense.
- Eine neue Kolonie erscheint ohne Neustart im nächsten Snapshot als eigene Station.
- Sichtbare Asteroiden, fremde Stationen und Trümmerfelder stammen aus der Vereinigungsmenge aller
  eigenen Scannerkreise.
- Unsichtbare Ziele und private fremde Bestände, Flottengrößen, Ressourcen, Forschung und Aufträge
  fehlen vollständig.
- `VisibleStation` enthält für sichtbare Stationen eine stabile `ownerId`. Eigene Kampfberichte
  enthalten Angreifer- und Verteidiger-Owner-ID, damit mehrere Stationen desselben Gegners
  zusammengeführt werden können.
- Die neue Owner-ID erweitert nur die Identität; sie legt keine zusätzlichen Wirtschaftsdaten
  offen.
- Räumliche Abfragen bleiben über Scanner-Chunkgrenzen begrenzt und laden nicht die gesamte Welt.
- Ein Integrationstest besitzt zwei Bot-Stationen, prüft lokale Ressourcenunterschiede und zeigt,
  dass ein außerhalb beider Scannerkreise liegendes Ziel fehlt.

### Nötige Umsetzungsinformationen

- Verträge:
  `docs/bot-system.md` und für Sichtbarkeit
  `docs/scanner-visibility-plan.md`.
- Bestehende Startpunkte:
  `apps/api/src/services/bot/bot-state.service.ts`,
  `apps/api/src/services/scanner-visibility.service.ts`,
  `apps/api/src/services/world.service.ts` und
  `packages/shared/src/world.ts`.
- `getUserScannerCoverages`, `scannerChunkBounds` und `isPointVisible` werden wiederverwendet.
- Öffentliche Stationsprofile liefern bereits `scaleTier`, grobe Modul-/Defense-Tiers und
  zivile/militärische Aktivität. Der Bot erhält keine darunterliegenden exakten Level.
- Kampfberichte werden in `apps/api/src/services/combat.service.ts` projiziert; die
  `combat_missions.user_id` ist bereits der Angreifer.
- Der Loader entscheidet nichts und führt keine Aktion aus. Er erzeugt nur einen typisierten
  Snapshot.

## GB-10 – Zielbewertung, Profile und Bindung als reine Logik umsetzen

### Konkretes Ziel

Aus typisierten Zielkandidaten wird deterministisch genau das beste langfristige Ziel gewählt,
ohne bei kleinen Scoreänderungen ständig zu wechseln.

### Feature-Beschreibung

Eine reine Entscheidungsfunktion bewertet Kandidaten anhand einer nachvollziehbaren
Score-Aufschlüsselung und der vier Profile. Zielgeneratoren und Ausführung folgen in späteren
Tickets.

### Acceptance Criteria

- Jeder Kandidat enthält Zieltyp, Kategorie, kanonische Zielreferenz und benannte Komponenten:
  `baseNeed`, `opportunity`, `longTermValue`, `commitment`, `cost`, `risk` und `blockers`.
- Die Komponenten liegen auf einer dokumentierten Skala von 0 bis 100.
- Der Score folgt:
  `baseNeed * categoryWeight + opportunity + longTermValue * futureWeight + commitment - cost - risk * riskWeight - blockers`.
- Kategoriegewichte entsprechen exakt der Tabelle im Plan.
- Erste Parameterbaseline:

  | Profil        | futureWeight | riskWeight | Kolonisationsfaktor | Aggressionsfaktor |
  | ------------- | -----------: | ---------: | ------------------: | ----------------: |
  | Industrieller |          1,0 |        1,3 |                 0,8 |               0,5 |
  | Pionier       |          1,1 |        1,0 |                 1,5 |               0,7 |
  | Technokrat    |          1,5 |        1,0 |                 0,9 |               0,8 |
  | Warlord       |          0,9 |        0,7 |                 0,8 |               1,5 |

- Ohne aktives Ziel gewinnt der höchste positive Score.
- Ein gültiges aktives Ziel bleibt gebunden, bis ein anderer Kandidat mindestens 25 Prozent höher
  bewertet ist.
- `complete`, unmöglich, anhaltend `blocked` oder eine unmittelbare Bedrohung erlauben einen
  sofortigen Wechsel.
- Gleichstand wird über `goalType` und anschließend `targetRef` aufgelöst.
- Das Ergebnis enthält Score-Aufschlüsselung und einen kurzen internen Grund.
- Unit-Tests prüfen alle vier Profilgewichtungen, 25-Prozent-Hysterese, Gleichstand und identische
  Ergebnisse bei identischem Input.

### Nötige Umsetzungsinformationen

- Fachlicher Vertrag:
  [Zielbewertung und Bindung](./goal-driven-bots-plan.md#zielbewertung-und-bindung).
- Startpunkt für reine Logik:
  `apps/api/src/services/bot/economic-v1.ts` zeigt das aktuelle Muster und
  `apps/api/test/unit/bot-decision.test.ts` den bevorzugten Teststil.
- Neue Logik darf in einer kleinen Datei wie `goal-driven-v1.ts` liegen; kein Klassenbaum und keine
  Strategie-Factory.
- Profilparameter sind Bot-Strategieparameter in `apps/api`, keine allgemeinen Spielregeln.
- Kandidatengeneratoren dürfen später benannte Komponenten liefern; sie dürfen keine freie
  Formelsprache oder untypisierte Metadaten einführen.

## GB-11 – Persistenten Ziel-Lebenszyklus in den Bot-Tick integrieren

### Konkretes Ziel

Der Bot behält, verfolgt und erklärt ein aktives Ziel über viele Ticks und unterscheidet echtes
Warten, Sparen, Blockade und Abschluss.

### Feature-Beschreibung

Der atomare Entscheidungs-Claim bleibt erhalten. Nach dem Laden des Snapshots werden Wartung,
Zielauswahl und genau ein nächster legaler Schritt ausgeführt. Die Strategie wird noch nicht für
alle provisionierten Bots aktiviert.

### Acceptance Criteria

- Der bestehende atomare Claim auf `nextDecisionAt` verhindert weiterhin doppelte Entscheidungen.
- Ein Entscheidungsergebnis ist genau eines von:
  erfolgreiche Aktion, `waiting`, `saving`, `blocked` oder `complete`.
- `waiting` nennt einen existierenden laufenden Vorgang; `saving` nennt bekannte Kosten und
  reguläres Einkommen; `blocked` nennt die fehlende Voraussetzung ohne erkennbaren Pfad.
- Eine erfolgreiche Aktion oder andere messbare Zustandsänderung aktualisiert `lastProgressAt`.
- Ein Ziel, das während fünf aufeinanderfolgenden normalen Entscheidungsintervallen `blocked`
  bleibt und keinen Fortschritt erzielt, wird freigegeben.
- Freiwillige Wechsel verwenden die 25-Prozent-Regel aus GB-10.
- Dringende Wartung darf vor dem Zielschritt genau eine Aktion ausführen. Sie darf pro Ressource
  nicht unter die bekannten reservierten Kosten des aktiven Zielschritts ausgeben.
- `lastAction` und `lastReason` erklären die tatsächlich ausgeführte Aktion oder den Wartezustand
  und bleiben innerhalb der vorhandenen Spaltenlängen.
- Der nächste Termin liegt bei 60 Sekunden plus einem stabilen botabhängigen Offset von 0 bis 15
  Sekunden.
- Zwei parallele Ticks führen weiterhin höchstens eine erfolgreiche Domain-Aktion aus.

### Nötige Umsetzungsinformationen

- Vertrag:
  [Ziele und Aktionen](./goal-driven-bots-plan.md#ziele-und-aktionen) und
  [Fortschritt und Stillstand](./goal-driven-bots-plan.md#fortschritt-und-stillstand).
- Orchestrierung:
  `apps/api/src/services/bot/bot.service.ts`.
- Der Dispatcher ruft weiterhin nur bestehende Domain-Services auf. Er schreibt keine Ressourcen,
  Schiffe, Gebäude, Forschung oder Missionen direkt.
- Erwartete Domain-Fehler werden als fehlgeschlagener/blocked Schritt protokolliert; unerwartete
  Fehler bleiben Warnungen.
- Zielauswahl und nächste Aktion dürfen im selben Tick stattfinden, solange insgesamt höchstens eine
  erfolgreiche Spielaktion entsteht.
- Integrationstest:
  `apps/api/test/integration/bot.behavior.test.ts`.

## GB-12 – Stationsstabilisierung, Einkommen und Kapazität ergänzen

### Konkretes Ziel

Die neue Strategie kann jede eigene Station arbeitsfähig machen, ihre Miningwirtschaft ausbauen
und einen konkreten Kapazitätsengpass beseitigen.

### Feature-Beschreibung

Die Ziele `stabilize_station`, `increase_income` und `increase_capacity` bilden den bisherigen
wirtschaftlichen Pfad als typisierte, unterbrechbare Ziele ab und wenden ihn auf mehrere Stationen
an.

### Acceptance Criteria

- `stabilize_station` ist für eine neue Station abgeschlossen, sobald mindestens ein Miner einen
  regulären, nicht erschöpften Mininglauf betreibt und Lieferung nicht dauerhaft an voller
  Lagerkapazität scheitert.
- Nächste Stabilisierungsschritte sind in dieser Reihenfolge: freien Miner zuweisen, fehlende erste
  Mole bauen, notwendigen lokalen Scanner-/Lagerengpass einmal ausbauen, andernfalls klar
  `blocked`.
- Das erneute Zuweisen eines freien Miners ist eine dringende Wartungsaktion und ersetzt das aktive
  strategische Ziel nicht.
- `increase_income` verwendet als erste messbare Meilensteine drei Mole und anschließend einen
  Titan. Notwendige Shipyard- und Hangarvoraussetzungen werden als kurze nächste Schritte
  behandelt.
- `increase_capacity` entsteht nur für einen bekannten Engpass eines attraktiven Ziels und benennt
  Station plus `warehouse`, `hangar` oder `laboratory`. Nach genau einem erfolgreichen Ausbau wird
  neu bewertet.
- Ressourcen und Schiffe einer anderen eigenen Station werden nie verwendet oder verrechnet.
- Bei mehreren geeigneten Stationen gewinnt zuerst eine unstabile neue Kolonie, sonst der höhere
  lokale Bedarf und dann die Stations-ID.
- Alle Aktionen laufen über `createAsteroidAssignment`, `buildSpacecrafts` oder
  `startBuildingUpgrade`.
- Unit-Tests schützen die Reihenfolge; ein Integrationstest zeigt den normalen Servicepfad samt
  Kosten und Queue.

### Nötige Umsetzungsinformationen

- Miningvertrag:
  `docs/mining-loop.md`.
- Kapazitätsvertrag:
  `docs/station-capacities.md`.
- Bestehende wirtschaftliche Baseline:
  `apps/api/src/services/bot/economic-v1.ts`.
- Domain-Services:
  `mining/assignment.service.ts`, `spacecraft.service.ts` und `building.service.ts`.
- `COLONIZATION_COST` oder fremde Stationsressourcen sind kein verfügbares Einkommen.
- Die Meilensteine sind eine erste Bot-Baseline, kein neues Spielerlimit. Spieler können weiterhin
  beliebig nach vorhandenen Regeln ausbauen.

## GB-13 – Erklärbare Forschungswahl ergänzen

### Konkretes Ziel

Der Bot wählt und verfolgt genau die Forschung, die seinem Profil, aktuellen Ziel und tatsächlich
vorhandenen Nutznießern am meisten hilft.

### Feature-Beschreibung

`research_technology` erzeugt für jede verfügbare Technologie einen Kandidaten. Die Wahl ist
erklärbar und führt über Laborplatz, Ressourcen, Start und Wartezeit bis zum Abschluss.

### Acceptance Criteria

- Für jede noch nicht gestartete Technologie kann ein Kandidat entstehen.
- Der Nutzen berücksichtigt mindestens:
  - `automated_shipyard`: geplante oder laufende Schiffsbauten;
  - `extraction_algorithms`: Anzahl und Aktivität eigener Miner;
  - `modular_cargo_frames`: Miner, Bergungsschiffe und beobachtbare Cargoengpässe;
  - `vector_navigation`: Anzahl, Dauer und Entfernung eigener geplanter Reisen;
  - `combat_analytics`: eigene Fighter und ein aktives Konflikt-/Flottenziel;
  - `station_grid_optimization`: geplante Gebäude- oder Defense-Upgrades.
- Das Technokratenprofil gewichtet bei vergleichbarem Bedarf Forschung höher, besitzt aber keinen
  exklusiven Zugriff.
- Reicht Laborkapazität nicht, kann ein konkretes `increase_capacity` für `laboratory` entstehen.
- Reichen Ressourcen nicht, liefert das Ziel `saving`, sofern reguläres Einkommen die Kosten
  erreichen kann; sonst `blocked`.
- Eine gestartete Forschung führt zu `waiting`; erst Status `completed` beendet das Ziel.
- Der Ausführungsgrund nennt Technologie und den wichtigsten konkreten Nutzen, zum Beispiel aktive
  Miner oder entfernte Frontier-Ziele.
- Start erfolgt ausschließlich über `startResearch`.
- Ein Unit-Test erzeugt für vier charakteristische Zustände unterschiedliche nachvollziehbare
  Forschungswahlen; ein Integrationstest prüft Kosten, Kapazität und Abschluss.

### Nötige Umsetzungsinformationen

- Forschungsgrundlagen:
  [Forschungsgrundlagen](./goal-driven-bots-plan.md#forschungsgrundlagen).
- Definitionen:
  `packages/game-config/src/research.ts`.
- Zustand und Aktion:
  `apps/api/src/services/research.service.ts`.
- Alle sechs Forschungen sind einmalig, ohne Baum, Stufen oder Abhängigkeiten.
- Bot-Scoring darf die tatsächlichen Effekte aus GB-03 bis GB-07 lesen, sie aber nicht duplizieren.

## GB-14 – Exploration, Kolonisation und Koloniestabilisierung ergänzen

### Konkretes Ziel

Der Bot kann einen Frontier-Sektor entdecken, dort regulär eine Station gründen und diese Station
anschließend selbstständig arbeitsfähig machen.

### Feature-Beschreibung

Die Ziele `explore_sector` und `establish_colony` verwenden die vorhandenen Weltmissionen. Der
Pionier bevorzugt diese Chancen, aber jedes Profil darf bei ausreichendem Bedarf expandieren.

### Acceptance Criteria

- `explore_sector` wählt ausschließlich von `getFrontierTargets` gelieferte Koordinaten.
- Entfernung, verfügbare Schiffe, laufende Expeditionen und stabile Koordinatenreihenfolge
  bestimmen den nächsten Zielsektor.
- `establish_colony` wählt ausschließlich einen von `getKnownSectors` als Frontier gelieferten
  Sektor ohne eigene Station.
- Der Startbahnhof muss `COLONIZATION_COST` lokal tragen, einen verfügbaren Miner besitzen und darf
  keine für ein höher gebundenes Ziel reservierten Ressourcen ausgeben.
- Expedition und Kolonisation starten ausschließlich über `startExpedition` und
  `startColonization`.
- Kolonienamen sind deterministisch, beispielsweise `Outpost <sectorX>:<sectorY>`.
- Eine reisende Mission führt zu `waiting`.
- `establish_colony` ist erst `complete`, wenn die neue Station die Stabilisierungskriterien aus
  GB-12 erfüllt; bis dahin besitzt sie hohe Wartungs-/Zielpriorität.
- Pioniere erhalten den festgelegten Kolonisationsfaktor 1,5. Andere Profile können bei
  Ressourcenmangel oder fehlenden erreichbaren Asteroiden dennoch expandieren.
- Ein Integrationstest führt einen Bot durch Expedition, Kolonisation und ersten Mininglauf der
  neuen Station.

### Nötige Umsetzungsinformationen

- Weltvertrag:
  `docs/world-generation.md`.
- Mehrstationsregeln:
  [Mehrere eigene Stationen](./goal-driven-bots-plan.md#mehrere-eigene-stationen).
- Domain-Service:
  `apps/api/src/services/world-mission.service.ts`.
- Kosten:
  `COLONIZATION_COST` aus `packages/game-config`.
- Ohne existierende Transportmechanik werden keine Ressourcen oder Flotten zwischen den Stationen
  verschoben.

## GB-15 – Befestigung und Aufbau einer Angriffsflotte ergänzen

### Konkretes Ziel

Der Bot kann eine bedrohte Station gezielt befestigen und für ein konkretes Konfliktziel genügend
lokale Fighter-Kampfkraft aufbauen.

### Feature-Beschreibung

`fortify_station` verbessert die wirtschaftlich sinnvollste statische Defense.
`build_strike_force` baut Fighter und nur die unmittelbar notwendigen Shipyard-/Hangarvoraussetzungen
für eine benannte Zielkampfkraft.

### Acceptance Criteria

- `fortify_station` erhält Station und gewünschte Defense-Punktzahl als messbares Ziel.
- Neue/isolierte Kolonien, kürzlich angegriffene Stationen und wertvollere ausgebaute Stationen
  erzeugen einen höheren Zielwert.
- Der nächste Defense-Ausbau maximiert den bekannten Defense-Zuwachs relativ zu lokal bezahlbaren
  Kosten; Gleichstand entscheidet `DefenseUpgradeKey`.
- Upgrades starten ausschließlich über `startDefenseUpgrade`.
- `build_strike_force` besitzt eine konkrete lokale Ziel-Angriffskraft und zählt vorhandene plus
  bereits bestellte Fighter.
- Der nächste Fighter wird unter bereits freigeschalteten Typen anhand Angriffskraft relativ zu
  Kosten und Crew gewählt; notwendiger Shipyard- oder Hangarausbau ist nur ein kurzer
  Voraussetzungsschritt.
- Schiffsbau startet ausschließlich über `buildSpacecrafts`, Gebäudeausbau über
  `startBuildingUpgrade`.
- Militärische Ressourcen einer anderen Station werden nicht angerechnet.
- Das Ziel endet beim Erreichen der Zielkampfkraft und baut nicht unbegrenzt weiter.
- Unit-Tests prüfen Defense-Auswahl, Fighter-Auswahl, Voraussetzung und lokale Begrenzung;
  Integrationstests schützen die normalen Kosten-/Queuepfade.

### Nötige Umsetzungsinformationen

- Defense:
  `apps/api/src/services/defense.service.ts` und
  `packages/game-config/src/defense.ts`.
- Fighter, Unlocks, Kosten und Crew:
  `apps/api/src/services/spacecraft.service.ts`,
  `packages/game-config/src/spacecrafts.ts` und
  `packages/game-config/src/buildings.ts`.
- Eigene Kampfkraft darf exakt sein. Fremde Zielschätzung folgt erst in GB-16.
- Nicht Teil: Flottenverlegung zwischen Stationen, Formationen oder neue Fightertypen.

## GB-16 – Feindseligkeit, öffentliche Zielschätzung und Reserve berechnen

### Konkretes Ziel

Der Bot erkennt zeitweilige Gegner aus echten Kampfberichten, schätzt sichtbare Ziele ohne private
Daten und bestimmt pro eigener Station eine sichere militärische Reserve.

### Feature-Beschreibung

Diese reine Konfliktlogik erzeugt noch keinen Angriff. Sie liefert Gegnerzustand, Zielscore,
geschätzte Verteidigung und lokal verfügbaren Überschuss für Raid, Vergeltung und Flottenaufbau.

### Acceptance Criteria

- Eine nur sichtbare Station ist neutral.
- Feindseligkeit wird accountweit aus eigenen Kampfberichten abgeleitet:
  eingehende und wiederholte Angriffe sowie eigene Verluste erhöhen sie; volle ruhige Tage und
  erfolgreiche Vergeltung senken sie.
- Erste Schwellenwerte sind `neutral < 30`, `rival 30–59`, `hostile >= 60`.
- Es entsteht keine permanente Feindliste und keine Diplomatie-/Hostility-Tabelle.
- Zielschätzung verwendet ausschließlich `VisibleStation.visualProfile`, Entfernung, sichtbare
  militärische Aktivität und eigene frühere Berichte.
- Exakte fremde Ressourcen, Schiffstypen, Flottengrößen, Defense-Level und Forschung werden weder
  geladen noch verwendet.
- Die grobe Defense-Schätzung verwendet die bekannten Obergrenzen der visuellen Tiers aus
  `station-visual.service.ts`; sie bleibt ausdrücklich eine Schätzung.
- Normale lokale Reserve:
  Industrieller 70 Prozent, Pionier 60 Prozent, Technokrat 60 Prozent, Warlord 37,5 Prozent der
  eigenen Fighter-Angriffskraft.
- Ein eingehender Angriff in den letzten 24 Stunden erhöht die Reserve um 15 Prozentpunkte, eine
  noch unstabile Kolonie um weitere 10; die Reserve ist bei 90 Prozent gedeckelt.
- Der Zielscore berücksichtigt Vergeltungswert, grob erwartbare Beute, Entfernung,
  Profilaggression, Rivalität, geschätzte Verteidigung, erwarteten Verlust und Opportunitätskosten.
- Eine stabile Affinität aus Bot-Owner-ID und Ziel-Owner-ID bricht nahe Scores, damit nicht alle
  Bots dasselbe Ziel wählen.
- Unit-Tests prüfen Verfall, Vergeltung, ausschließlich öffentliche Inputs, alle Reserven und stabile
  Zielverteilung.

### Nötige Umsetzungsinformationen

- Konfliktvertrag:
  [Konfliktverhalten](./goal-driven-bots-plan.md#konfliktverhalten).
- Berichte:
  `packages/shared/src/combat.ts` und
  `apps/api/src/services/combat.service.ts`.
- Öffentliche Tiers:
  `apps/api/src/services/station-visual.service.ts`.
- Eigene Fighterwerte:
  `packages/game-config/src/spacecrafts.ts`; `combat_analytics` aus GB-06 muss berücksichtigt werden.
- Eine einfache explizite Funktion mit benannten Zwischenwerten ist gewünscht. Kein
  Machine-Learning-Modell, keine Simulation hypothetischer Kampfrunden und keine private
  Datenabfrage.

## GB-17 – Raid und Vergeltung als normale Kampfaktionen ergänzen

### Konkretes Ziel

Der Bot kann aus der geeigneten eigenen Station eine begrenzte Flotte für einen opportunistischen
Raid oder eine konkrete Vergeltung starten.

### Feature-Beschreibung

`raid` und `retaliate` verwenden Zielscore, Reserve und Defense-Schätzung aus GB-16. Die Aktion
sendet die kleinste einzelne vorhandene Fightergruppe, die Zielschätzung plus Profilsicherheitsmarge
übertrifft.

### Acceptance Criteria

- Priorität im Konfliktbereich:
  unmittelbare Bedrohung beziehungsweise Befestigung, dann vorteilhafte Vergeltung, dann
  opportunistischer Raid.
- Sicherheitsmargen auf geschätzte Ziel-Defense:
  Industrieller 1,40, Pionier 1,30, Technokrat 1,25, Warlord 1,15.
- Nach Abzug der lokalen Reserve wird nur die kleinste ausreichende Anzahl Fighter gesendet.
- `startAttack` akzeptiert aktuell nur einen `spacecraftKey`; verschiedene Fightertypen werden nicht
  zu einer erfundenen Mischflotte kombiniert.
- Kann keine einzelne verfügbare Gruppe das Ziel erreichen, entsteht stattdessen
  `build_strike_force` oder kein Angriff.
- Unter mehreren eigenen Stationen startet die nächste Station, die Zielmarge und lokale Reserve
  erfüllt; Gleichstand entscheidet Stations-ID.
- Jeder Angriff läuft ausschließlich über `startAttack` und damit durch Sichtbarkeit,
  Eigentumsprüfung, Flottensperre und Schutz junger Accounts.
- Erste Ziel-Cooldowns:
  6 Stunden nach gewonnenem Angriff und 24 Stunden nach Niederlage. Ein neuer eingehender Angriff
  desselben Gegners erlaubt nach 1 Stunde erneut eine Vergeltungsprüfung.
- Eine Ablehnung wegen jungem Account erzeugt keine Aktion und frühestens nach 1 Stunde einen
  erneuten Versuch auf dieses gebundene Ziel.
- Erfolgreiche Vergeltung reduziert bei der nächsten Bewertung die Feindseligkeit; es entsteht keine
  endlose Racheschleife.
- Kampf verursacht weiterhin nur Verluste, Beute und Trümmer, niemals Stationsübernahme.
- Unit-Tests prüfen Flottengröße, Reserve, Stationswahl und Cooldown. Ein Integrationstest startet
  den Angriff über den normalen Service und löst ihn vollständig auf.

### Nötige Umsetzungsinformationen

- Aktion:
  `apps/api/src/services/combat.service.ts`.
- Eigene verfügbare Menge ist `amount - lockedAmount`.
- Für die Angriffsgröße zählt effektive Angriffskraft inklusive `combat_analytics`; für die Reserve
  zählt derselbe lokale Fighterbestand.
- Cooldowns sind vorläufige Bot-Strategiewerte in `apps/api`, keine öffentlich sichtbaren
  Spielregeln.
- Ein erwarteter Schutzfehler wird als `waiting` mit Grund behandelt, nicht als permanenter Gegner-
  oder Schutzdatensatz.

## GB-18 – Bergung gegen Mining und Ausbau abwägen

### Konkretes Ziel

Der Bot birgt ein sichtbares Trümmerfeld nur dann, wenn dessen erwarteter lokaler Nutzen die
Mining- oder Ausbaualternative übertrifft.

### Feature-Beschreibung

`salvage` bewertet beobachtbare Ressourcen, Entfernung, effektive Fracht und Reisezeit. Ein
Bergungsschiff wird nur für ein plausibel lohnendes bereits sichtbares Trümmerfeld gebaut.

### Acceptance Criteria

- Nur von der normalen Sichtbarkeitsprojektion gelieferte Trümmerfelder sind Kandidaten.
- Der Wert berücksichtigt lokal fehlende Zielressourcen, bergbare Menge, Hin-/Rückreise,
  `modular_cargo_frames`, `vector_navigation` und die Lagergrenze der Startstation.
- Der Kandidat vergleicht gewichteten erwarteten Wert pro Stunde mit dem besten bekannten lokalen
  Mininglauf.
- Ein vorhandenes freies Bergungsschiff wird vor einem Neubau verwendet.
- Ein Collector wird nur gebaut, wenn die gewichtete, innerhalb einer Reise bergbare Menge
  mindestens 125 Prozent seiner lokal gewichteten Baukosten erreicht und Shipyard/Hangar dies
  zulassen.
- Start erfolgt ausschließlich über `startSalvage`; Neubau ausschließlich über
  `buildSpacecrafts`.
- Unter mehreren Stationen gewinnt die höchste erwartete Nettorate, dann die kürzere Entfernung und
  schließlich die Stations-ID.
- Verschwundene oder bereits geleerte Trümmer führen zu kontrolliertem `blocked`/Zielwechsel, nicht
  zu erfundenem Ersatzwert.
- Ein Unit-Test prüft Mining-vs.-Salvage, Collector-Payback und deterministischen Gleichstand. Ein
  Integrationstest schützt Sichtbarkeit, Cargo, Lagergrenze und normalen Rückflug.

### Nötige Umsetzungsinformationen

- Domain-Service:
  `apps/api/src/services/salvage.service.ts`.
- Sichtbarkeit:
  `getVisibleDebris`/`getDebrisById` und
  `docs/scanner-visibility-plan.md`.
- Miningvergleich:
  `calculateMiningCycle` und die Ressourcenbedarfsgewichtung aus der bisherigen
  `economic-v1.ts`.
- Schiffskosten und Rollen:
  `packages/game-config/src/spacecrafts.ts`.
- Keine globale Ressourcenpreisökonomie einführen. Die vorhandene Gewichtung nach lokalem
  Zielbedarf reicht für die erste Version.

## GB-19 – Zielstrategie aktivieren und Schritt 1 als Ganzes abnehmen

### Konkretes Ziel

Alle bestehenden und neu provisionierten Bots verwenden die vollständige zielorientierte Strategie
und zeigen reproduzierbar unterschiedliche langfristige Spielstile.

### Feature-Beschreibung

Nach Fertigstellung aller Fähigkeiten wird `goal_v1` aktiviert, die feste
`economic_v1`-Entscheidung entfernt und der Bot-Vertrag auf den tatsächlichen Zustand aktualisiert.
Dieses Ticket ist zugleich das Integrations-Gate für Schritt 1.

### Acceptance Criteria

- Bestehende Controller werden per Migration auf `goal_v1` mit der vorhandenen
  `strategyVersion` gesetzt; neue Controller starten direkt damit.
- `economic-v1.ts`, nur dafür vorhandene Typen und überholte Tests sind entfernt, sobald ihre
  wirtschaftlichen Fähigkeiten durch GB-12 abgedeckt sind.
- Alle vier Profile können Wirtschaft, Forschung, Expansion und Konflikt auswählen; kein
  Profil besitzt einen verbotenen Bereich.
- In einem kontrollierten Zustand mit vergleichbaren Chancen bevorzugen:
  Industrielle Wirtschaft, Pioniere Expansion, Technokraten Forschung und Warlords Konflikt.
- Ein dominanter dringender Bedarf kann bei jedem Profil die normale Präferenz überstimmen.
- Neue Kolonien werden vor weiteren riskanten Investitionen stabilisiert.
- Mehrere Stationen verwenden nur lokale Ressourcen und Reserven, aber accountweite Profile und
  Konfliktgeschichte.
- Identischer Datenbankzustand und Zeitpunkt erzeugen dieselbe Zielwahl, Aktion und Begründung.
- Parallele und überfällige Ticks bleiben genau einmal wirksam; ein Datenbankneustart verliert kein
  Profil oder aktives Ziel.
- Eine erfolgreiche Entscheidung löst höchstens eine normale Domain-Aktion aus.
- Spielerantworten enthalten keine internen Ziele, Scores oder Gründe und keine privaten fremden
  Daten.
- `docs/bot-system.md` beschreibt `goal_v1`, Profile, Zielbindung, Mehrstationen und alle
  verbindlichen Prüfungen. `docs/implementation-plan.md` markiert Schritt 1 erst nach bestandener
  Abnahme als umgesetzt.
- `npm run verify` besteht vollständig.

### Nötige Umsetzungsinformationen

- Orchestrierung:
  `apps/api/src/services/bot/bot.service.ts`.
- Provisionierung:
  `apps/api/src/services/bot/bot-provision.service.ts`.
- Haupttests:
  `apps/api/test/unit/bot-decision.test.ts` und
  `apps/api/test/integration/bot.behavior.test.ts`.
- Bestehende Regressionen zu Weltmission, Kampf, Bergung, Forschung, Sichtbarkeit und Konkurrenz
  bleiben Bestandteil von `npm run verify`.
- Nicht Teil dieses Tickets: virtuelle Zeit, synthetische Spieler, JSON-Spieltestbericht,
  Softlock-Auswertung oder Balancingänderungen aus Messdaten. Das beginnt erst in Schritt 2.
