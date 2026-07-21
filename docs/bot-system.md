# Bot-System: konkreter Implementierungsplan

Status: erste wirtschaftliche Ausbaustufe abgeschlossen am 20. Juli 2026.

Umgesetzt sind die Schritte 8.1 bis 9.3: abgesicherte gemeinsame Domain-Services, persistente
Bot-Controller und idempotente Seeds, die deterministische Strategie `economic_v1`, der
restart-sichere Entscheidungstakt sowie reguläres Mining und Wachstum über die vorhandenen
Queues. Bot-Stationen und laufende Reisen erscheinen in der gemeinsamen Weltansicht, ohne private
Bestände oder Ladungen offenzulegen. Die unter „Vorbereitung zukünftiger Systeme“ beschriebenen
Mechaniken bleiben bewusst vorgemerkt, bis sie auch für Spieler existieren.

Dieses Dokument detailliert die Phasen 8 bis 10 des
[Umsetzungsplans](./implementation-plan.md). Das Ziel ist eine belebte persistente Welt, in der
Bots und Spieler dieselben fachlichen Regeln verwenden. Der erste Bot ist ein wirtschaftlicher
Akteur mit einer Station. Er weist Miner zu, erhält reguläre Lieferungen und investiert diese über
dieselben Gebäude- und Schiffbau-Queues wie ein Spieler.

## Ziel und Grenze

Ein Bot besteht aus zwei Teilen:

- einem normalen Benutzer mit normalen Stationen, Ressourcen, Gebäuden, Schiffen und Reisen;
- einem kleinen Controller, der in Abständen genau eine reguläre Aktion auswählt.

Der Controller entscheidet. Die vorhandenen Services führen aus. Er schreibt niemals selbst
Ressourcen gut, erzeugt keine Schiffe, verändert keine Bauzeit und führt Mining nicht erneut aus.

```text
Spieler -> HTTP-Route -----+
                          +-> Domain-Service -> PostgreSQL -> Simulation
Bot -> Bot-Entscheider ----+
```

Gleiche Regeln bedeuten denselben Domain-Service und dieselben Datenbanktabellen, nicht denselben
Transportweg. Bots senden daher keine künstlichen HTTP-Anfragen an die eigene API.

## Bewusst nicht übernehmen

Project Atlas dient als Vorbild für gemeinsame, deterministische Weltregeln. Aus dem alten Project
Browsergame können einfache Prioritäten als Orientierung dienen. Nicht übernommen werden:

- eigene Bot-Ressourcen oder Bot-Schiffstabellen;
- regelmäßige Ressourcengeschenke nach Schwierigkeit;
- sofort erzeugte Flotten außerhalb der Bau-Queue;
- globale Schwierigkeitsmultiplikatoren auf Kosten oder Erträge;
- ein allgemeines KI-, Ziel-, Utility- oder Behavior-Tree-Framework;
- Redis, BullMQ oder ein separater Bot-Prozess.

## Festgelegte erste Version

Für den ersten vertikalen Schnitt gelten folgende Startwerte:

- drei Bots in freien Spawn-Slots des Startsektors;
- eine Station und dieselbe Startausstattung wie bei einem neuen Spieler;
- eine Strategie `economic_v1`;
- eine Entscheidung pro Bot und Minute;
- höchstens eine erfolgreiche Aktion pro Entscheidung;
- strategisches Ziel: höchstens drei Mole und später ein Titan;
- keine Kampf-, Salvage-, Handels- oder Expeditionsentscheidungen;
- bei fehlender gültiger Aktion wartet der Bot ohne Ausgleich.

Die Werte sind veränderbare Startwerte im Code, noch keine Balance. Die geografische Lage sorgt
bereits bei identischem Verhalten für unterschiedliche Entwicklungen.

## Datenmodell

Bots verwenden weiterhin `users`, `stations`, `station_resources`, `station_buildings`,
`station_spacecrafts`, `spacecraft_build_orders`, `asteroid_assignments` und `spacecraft_trips`.
Neu entsteht nur der persistente Controller-Zustand:

```text
bot_controllers
  user_id             uuid primary key -> users.id on delete cascade
  strategy            varchar(32) not null default 'economic_v1'
  next_decision_at    timestamp not null
  last_action         varchar(64) null
  last_reason         varchar(255) null
  updated_at          timestamp not null default now()

index(next_decision_at)
```

Der Controller verweist auf den Benutzer statt auf eine Station. Heute besitzt dieser Benutzer
genau eine Station. Später kann derselbe Controller mehrere eigene Stationen betrachten, ohne das
Datenmodell zu ändern. Erst wenn viele Stationen nachweislich unabhängige Entscheidungstakte
benötigen, kommt ein stationseigener Controller-Zustand hinzu.

Ein Bot-Benutzer bleibt über die vorhandene Benutzer-ID Eigentümer seiner Station. Die Existenz
eines `bot_controllers`-Eintrags kennzeichnet ihn als Bot; `users` benötigt kein zusätzliches
`actorType`. Das beim Seed erzeugte Passwort wird verworfen und kann nicht zum Login verwendet
werden.

Nicht gespeichert werden Entscheidungs-Snapshots, Aktionsqueues, Ziele als JSON oder ein
vollständiges Entscheidungsprotokoll. `lastAction` und `lastReason` genügen zunächst für Logs und
Fehlersuche.

## Gemeinsame fachliche Aktionen

Der Bot darf ausschließlich folgende vorhandene Aktionen auslösen:

| Aktion             | Vorhandener Service               | Vorbereitende Änderung                                             |
| ------------------ | --------------------------------- | ------------------------------------------------------------------ |
| Miner zuweisen     | `createAsteroidAssignment`        | bereits mit Eigentum, Sichtbarkeit, Slots und Schiffen abgesichert |
| Mining zurückrufen | `requestAsteroidAssignmentRecall` | `userId` in den Service aufnehmen und Eigentum dort prüfen         |
| Schiff bauen       | `buildSpacecrafts`                | Station innerhalb der Transaktion auch über `userId` prüfen        |
| Gebäude ausbauen   | `startBuildingUpgrade`            | Station innerhalb der Transaktion auch über `userId` prüfen        |
| Station gründen    | `createStation`                   | für den idempotenten Bot-Seed wiederverwenden                      |

HTTP-Routen dürfen ihre Vorprüfung behalten, aber Sicherheit und Spielregeln müssen im Service
liegen. Dadurch kann kein zukünftiger Aufrufer – Bot, Admin-Werkzeug oder weiterer Transport – die
Regeln versehentlich umgehen.

Für neue Spielsysteme gilt später dieselbe Reihenfolge:

1. Spielermechanik und serverseitige Fachaktion implementieren.
2. Zeit, Kosten, Ergebnis und Konkurrenz transaktional absichern.
3. UI und ausführbaren Verhaltenscheck ergänzen.
4. Erst danach darf eine Bot-Entscheidung diese Aktion auswählen.

## Entscheidungszustand

Ein interner Loader erzeugt pro Bot einen kleinen aktuellen Zustand. Er wird nicht in
`packages/shared` veröffentlicht, weil er weder API-Vertrag noch Frontend-Typ ist.

Er enthält nur Daten, die für eine heutige Entscheidung nötig sind:

- Benutzer-ID und eigene Station mit Position;
- Ressourcenbestand der Station;
- Shipyard-Level und laufendes Upgrade;
- vorhandene, gebundene und in Bau befindliche Mole und Titan;
- sichtbare, nicht erschöpfte Asteroiden mit Adern und Restmengen;
- Entfernung, freie Mining-Slots und vorhandene Zuweisungen;
- Kosten des nächsten wirtschaftlichen Ziels.

Die Asteroidensichtbarkeit wird mit `getUserScannerStrength` und derselben `hiddenLevel`-Regel wie
bei einem Spieler bestimmt. Entfernung und Lieferleistung verwenden `calcDistance` und
`calculateMiningCycle`. Der Bot erhält keine versteckte Karteninformation und keine vereinfachte
Ertragsformel.

## Entscheidungsmodell `economic_v1`

Die Entscheidung ist eine reine Funktion: Zustand hinein, eine Absicht oder `wait` heraus. Eine
kleine diskriminierte Union genügt:

```text
assign_miner | build_spacecraft | upgrade_building | wait
```

Es gibt keine dynamische Aktionsregistrierung. Neue Varianten kommen erst hinzu, wenn die
zugehörige Spieleraktion existiert.

### Reihenfolge

1. Einen freien Titan einem passenden Asteroiden zuweisen.
2. Andernfalls einen freien Mole einem passenden Asteroiden zuweisen.
3. Wenn weniger als drei Mole vorhanden oder in Bau sind, genau einen Mole bauen, sobald die
   Ressourcen reichen und noch kein entsprechender Bauauftrag läuft.
4. Ab drei Mole das Shipyard schrittweise bis Level 5 ausbauen, sofern kein Upgrade läuft und die
   Kosten vorhanden sind.
5. Ab Shipyard-Level 5 genau einen Titan bauen, sofern keiner vorhanden oder in Bau ist.
6. Andernfalls warten.

Freie Miner werden zuerst eingesetzt, damit ein möglicher Bau oder Ausbau die bestehende
Produktion nicht unnötig verzögert. Pro Entscheidung wird nur die erste erfolgreich ausführbare
Aktion verwendet.

### Wirtschaftliches Ziel und Asteroidenwahl

Das nächste Investitionsziel bestimmt, welche Ressourcen knapp sind:

- unter drei Mole: Kosten eines Mole;
- danach: Kosten des nächsten Shipyard-Levels;
- ab Shipyard-Level 5: Kosten eines Titan;
- nach Erreichen des ersten Flottenziels: gleichmäßige Grundreserve.

Für jede benötigte Ressource wird die Deckung berechnet:

```text
Deckung = vorhandene Menge / benötigte Menge
```

Ressourcen mit der geringsten Deckung erhalten das höchste Gewicht. Ein Asteroid wird anschließend
mit der bereits vorhandenen tatsächlichen Lieferleistung bewertet:

```text
Bewertung = erwartete Lieferleistung × Ressourcenbedarf
```

Nicht sichtbar, erschöpft oder vollständig durch andere Stationen belegte Asteroiden sind keine
Kandidaten. Bei gleicher Bewertung gewinnt die stabile Sortierung nach Asteroiden-ID. Zufall wird
im ersten Verhalten nicht benötigt.

Die finale Zuweisung bleibt trotzdem fehlbar: Ein anderer Akteur kann den letzten Slot oder Vorrat
zwischen Entscheidung und Ausführung erhalten. Der Domain-Service lehnt dann regulär ab. Der Bot
wartet bis zur nächsten Entscheidung und erhält keine Sonderbehandlung.

## Ausführung und Zeit

Der bestehende API-interne Scheduler bleibt der einzige laufende Prozess:

1. `runSimulationTick(now)` beendet fällige Reisen, Gebäude-Upgrades und Schiffsbauten.
2. `runBotDecisionTick(now)` verarbeitet anschließend fällige Bot-Entscheidungen.
3. Erst der nächste reguläre Takt betrachtet daraus entstandene neue Fälligkeiten.

Vor der Aktion beansprucht ein bedingtes Update den Entscheidungszeitpunkt:

```text
update bot_controllers
set next_decision_at = now + 1 minute
where user_id = ? and next_decision_at <= now
returning user_id
```

Nur ein erfolgreicher Claim darf entscheiden. Ein Absturz nach dem Claim überspringt schlimmstenfalls
eine Entscheidung, erzeugt aber keine doppelte Aktion oder geschenkten Fortschritt. Für den
aktuellen einzelnen API-Prozess ist kein verteilter Lock nötig. Wenn später mehrere API-Instanzen
gleichzeitig Bots verarbeiten, bleibt das bedingte Update weiterhin die erste Schutzschicht.

Domain-Fehler wie ein inzwischen belegter Slot sind erwartete Fehlschläge. Sie werden knapp
protokolliert und nicht sofort wiederholt. Unerwartete Fehler werden mit Bot-, Benutzer- und
Aktions-ID geloggt.

## Sichtbare gemeinsame Welt

Bots erfüllen ihren Zweck erst, wenn Spieler ihre Stationen und Aktivitäten beobachten können.
Der heutige Stand zeigt über die Chunk-Abfrage nur Asteroiden und über `/me/trips` nur eigene
Reisen.

Der kleinste Ausbau besteht aus:

- sichtbaren Stationen in der bestehenden Chunk-Antwort;
- einer sichtbarkeitsgefilterten Weltabfrage für laufende fremde Reisen;
- einer `StationLayer` für eigene und fremde Stationen;
- der vorhandenen `TripLayer` auch für sichtbare fremde Minerflüge.

Öffentlich sichtbar sind nur Station-ID, Name, Position und Bot-/Spieler-Kennzeichnung sowie bei
Reisen Position, Gruppengröße, Schiffsdarstellung, Zweck und Zeit. Ressourcenbestände,
Ladungsinhalt, Bauaufträge und interne Bot-Gründe bleiben privat.

Stationen sind ortsfest und passen in den Chunk-Lebenszyklus. Laufende Reisen werden separat
aktualisiert, weil ihre Position wechselt. Die bestehende `/me/trips`-Abfrage bleibt für private
Details bestehen. Spätere Scanner-, Tarnungs- und Kampfregeln filtern die Weltabfrage zentral und
nicht erst im Frontend.

## Umsetzungsschritte

### 8.1 Mutierende Services absichern

Betroffene Dateien:

- `apps/api/src/services/spacecraft.service.ts`
- `apps/api/src/services/building.service.ts`
- `apps/api/src/services/mining/assignment.service.ts`
- zugehörige Routen und `apps/api/test/write-concurrency.behavior.test.ts`

Arbeiten:

1. Station in Schiffsbau und Upgrade mit `stationId` und `userId` auswählen.
2. Recall auf `assignmentId` und `userId` umstellen und die Station im Service joinen.
3. Routen nur noch Eingaben lesen, Service aufrufen und Ergebnis übersetzen lassen.
4. Fremde Stationen beziehungsweise Assignments in Verhaltenstests ablehnen.

Abgeschlossen, wenn direkte Service-Aufrufe dieselben Eigentumsgrenzen wie HTTP-Aufrufe besitzen.

### 8.2 Bot-Controller und Seed ergänzen

Neue beziehungsweise betroffene Dateien:

- `apps/api/src/lib/db/schema/bot-controllers.ts`
- `apps/api/src/lib/db/schema/index.ts`
- `apps/api/src/lib/db/migrations/0016_bot_controllers.sql`
- `apps/api/src/lib/db/migrations/meta/_journal.json`
- `apps/api/src/lib/seed.ts`
- `apps/api/src/index.ts`

Arbeiten:

1. Tabelle und Index aus dem oben beschriebenen Modell anlegen.
2. `seedWorldBots(3)` idempotent nach Welt und Spawn-Slots ausführen.
3. Bot-Benutzer über stabile interne E-Mail-Namen wiederfinden, fehlende Benutzer erzeugen und
   deren nicht verwendbares Passwort verwerfen.
4. Für jeden neuen Benutzer `createStation` aufrufen, damit Startressourcen, Gebäude und Mole exakt
   dem Spielerstart entsprechen.
5. Bei zu wenigen freien Spawn-Slots nur eine Warnung schreiben und den API-Start nicht abbrechen.

Der Seed ergänzt fehlende Bots, löscht aber niemals bestehende Bot-Stationen oder deren Fortschritt.

### 8.3 Zustand laden und Entscheidung rein testen

Neue Dateien:

- `apps/api/src/services/bot/bot-state.service.ts`
- `apps/api/src/services/bot/economic-v1.ts`
- `apps/api/test/bot-decision.test.ts`

Arbeiten:

1. Den kompakten Zustand mit wenigen gebündelten Abfragen laden.
2. Mining-Kandidaten mit vorhandener Sichtbarkeit, Entfernung und Mining-Berechnung bewerten.
3. Die feste Prioritätsliste als reine Funktion implementieren.
4. Mindestens Zuweisung, Mole-Bau, Shipyard-Upgrade, Titan-Bau und `wait` deterministisch testen.

Noch kein Scheduler und keine direkte Datenbankmutation gehören in `economic-v1.ts`.

### 8.4 Fällige Entscheidungen ausführen

Neue beziehungsweise betroffene Dateien:

- `apps/api/src/services/bot/bot.service.ts`
- `apps/api/src/services/simulation.service.ts`
- `apps/api/src/index.ts`
- `apps/api/test/bot.behavior.test.ts`

Arbeiten:

1. Fällige Controller lesen und einzeln atomar beanspruchen.
2. Zustand laden, Absicht bestimmen und über einen kleinen `switch` den bestehenden Service
   aufrufen.
3. `lastAction`, `lastReason` und `updatedAt` aktualisieren.
4. Bot-Tick nach dem Simulationstick ausführen und denselben In-Process-Scheduler verwenden.
5. Neustart, doppelten parallelen Tick und erwartete Aktionsfehler prüfen.

Abgeschlossen, wenn eine fällige Entscheidung höchstens eine reguläre Aktion erzeugt.

### 9.1 Ersten Mining-Bot aktivieren

Arbeiten:

1. Zunächst nur `assign_miner` und `wait` freigeben.
2. Bot mit derselben Mole auf einen regulär sichtbaren Asteroiden schicken.
3. Vorhandene Trip- und Mining-Simulation bis zur Lieferung laufen lassen.
4. Prüfen, dass der Bot-Bestand ausschließlich um die gelieferte Ladung wächst.
5. Konkurrenztest mit einem Spieler und einem Bot am selben Asteroiden ergänzen.

Dies ist der erste lauffähige Zwischenstand und wird vor weiterem Wachstum im Browser geprüft.

### 9.2 Reguläres Wachstum aktivieren

Arbeiten:

1. `build_spacecraft` bis zum Ziel von drei Mole aktivieren.
2. Danach `upgrade_building` bis Shipyard-Level 5 aktivieren.
3. Titan-Bau und anschließende Mining-Zuweisung aktivieren.
4. Queue-Zeiten, Kostenabzug, Freischaltung und Fertigstellung mit denselben Services prüfen.

Die Ziele begrenzen nur das gewünschte Verhalten. Spätere Hangarplätze bleiben die gemeinsame
harte Flottengrenze.

### 9.3 Bot-Aktivität in der Welt darstellen

Betroffene Bereiche:

- World-Routen und ein kleiner World-Query-Service in der API;
- sichtbare Welt-Typen in `packages/shared`;
- `ChunkStreamer`, `WorldRenderer`, `TripLayer` und eine neue `StationLayer` im Frontend;
- ein Verhaltenstest für öffentliche und private Felder.

Arbeiten:

1. Statische sichtbare Stationen mit den Asteroiden-Chunks laden.
2. Sichtbare laufende Reisen für den aktuellen Kartenausschnitt abfragen.
3. Eigene und fremde Stationen unterscheidbar, aber im selben Kartenmaßstab rendern.
4. Fremde Miningflüge ohne Cargo- oder Bestandsdaten animieren.
5. Weltprojektion nach Simulation- und Bot-Aktionen aktualisieren.

Abgeschlossen, wenn ein Spieler die Station, den Abflug, den Abbaukonflikt und die Rückkehr eines
Bots ohne Zugriff auf dessen private Wirtschaft beobachten kann.

## Tests und Abnahme

### Reine Entscheidungstests

- freier Miner wählt den besten gültigen Asteroiden;
- erschöpfte, unsichtbare und voll belegte Asteroiden werden ignoriert;
- fehlende Ressource verändert die Zielgewichtung nachvollziehbar;
- Flotten- und Ausbauziele erzeugen die erwartete nächste Absicht;
- gleicher Zustand erzeugt immer dieselbe Absicht.

### Datenbank-Verhaltenstests

- Bot und Spieler können fremde Stationen nicht verwenden;
- parallele Bot-Ticks beanspruchen denselben Zeitpunkt nur einmal;
- Restart mit überfälligem `nextDecisionAt` führt genau eine Entscheidung aus;
- Bot-Mining erzeugt dieselben Assignment- und Trip-Daten wie Spieler-Mining;
- Bot-Ressourcen entstehen nur durch Startausstattung und reguläre Lieferungen;
- Schiffsbau und Upgrade verwenden normale Kosten, Queues und Fertigstellung;
- Spieler und Bot konkurrieren über dieselben Mining-Slots und Restvorräte;
- fehlende Handlung lässt Ressourcen und Spielzustand unverändert.

### Gesamtabnahme

Die erste Bot-Phase ist abgeschlossen, wenn:

1. nach einem frischen Docker-Start drei Bot-Stationen und die Spielerstation existieren;
2. Bots ohne Benutzerinteraktion Miner versenden;
3. Miner sichtbar fliegen, abbauen, zurückkehren und regulär liefern;
4. Bots aus diesen Ressourcen über die bestehenden Queues wachsen;
5. API-Neustarts keine Aktionen duplizieren oder Fortschritt verlieren;
6. kein Bot-spezifischer Ressourcen-, Schiffs-, Bau- oder Mining-Pfad existiert;
7. `npm run verify` einschließlich der neuen Verhaltenstests besteht.

## Vorbereitung zukünftiger Systeme

Die Erweiterbarkeit entsteht durch gemeinsame Domain-Services und den kleinen Entscheidungs-Switch,
nicht durch vorab gebaute Frameworks.

| Zukünftiges System      | Gemeinsame Spielermechanik zuerst                                     | Spätere Bot-Erweiterung                                              |
| ----------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Hangarplätze            | Kapazität bei jedem Schiffsbau prüfen; abwesende Schiffe zählen mit   | Flottenziel zusätzlich durch freie Plätze begrenzen                  |
| Scanner und Entdeckung  | zentraler sichtbarer Weltzustand pro Benutzer                         | nur bekannte beziehungsweise sichtbare Ziele bewerten                |
| Kampf                   | Auftrag, Flug, Auflösung, Verluste und Beute als Domain-Service       | `start_combat` nach wirtschaftlicher/defensiver Priorität auswählen  |
| Verteidigung            | stationäre Verteidigung und anwesende Flotte gemeinsam auflösen       | Fighter oder Guardian über reguläre Bauaktionen priorisieren         |
| Salvage                 | Wrack, Frachtraum, Reise und Bergung als Spielerauftrag               | `start_salvage` nur für sichtbare Wracks auswählen                   |
| Handel                  | Angebot, Reservierung, Transport und Abschluss transaktional abbilden | kaufen oder verkaufen über denselben Marktservice                    |
| Expeditionen            | Ziel, Dauer, Risiko und Ergebnis serverseitig ausführen               | sichtbares Fragezeichen über regulären Expeditionsservice wählen     |
| Forschung               | Punkte, Kosten, Dauer und Freischaltung gemeinsam persistieren        | Laboratory beziehungsweise Forschung als neues Investitionsziel      |
| Betriebskosten          | Hydrogenium-Verbrauch und Konsequenzen für alle Stationen             | Reserve vor Wachstum priorisieren, ohne Sonderversorgung             |
| Mehrere Stationen       | Spieleraktionen erhalten weiterhin `stationId` plus Eigentümerprüfung | ein Controller bewertet alle eigenen Stationen und wählt eine Aktion |
| Eroberung               | Stationseigentum und laufende Vorgänge transaktional übertragen       | verlorene Station verschwindet automatisch aus dem Bot-Zustand       |
| Einfluss und Diplomatie | Beziehungen an Benutzer-/Akteurs-IDs knüpfen                          | Strategie gewichtet Handel, Verteidigung oder Angriff anders         |
| Persönlichkeiten        | keine neue Spielregel                                                 | weitere feste Strategiefunktionen neben `economic_v1`                |

Neue Systeme dürfen zusätzliche Absichten ergänzen, aber keine Bot-Variante einer bereits
vorhandenen Wirtschaftstabelle. Beispielsweise erhält Kampf eine gemeinsame Kampfmission und nicht
eine `bot_fleets`-Tabelle.

## Spätere technische Skalierung

Die erste Version verarbeitet wenige Bots sequenziell im API-Prozess. Erst bei gemessenen Problemen
werden folgende Schritte geprüft:

- fällige Bots in begrenzten Batches laden;
- mehrere API-Instanzen über bedingte Claims oder `skip locked` verteilen;
- Entscheidungsintervalle bei inaktiven oder weit entfernten Bots verlängern;
- Weltprojektionen räumlich indizieren und nur relevante Reisen übertragen;
- einen separaten Worker erst bei tatsächlicher CPU- oder Latenzbelastung einführen.

Diese Skalierung verändert nicht die Domain-Services und damit nicht die Gleichheit von Spieler-
und Bot-Regeln.

## Nicht Teil der ersten Implementierung

- unterschiedliche Fraktionen oder Persönlichkeiten;
- adaptive Schwierigkeit oder Lernen aus Spielerverhalten;
- koordinierte Angriffe mehrerer Bots;
- Diplomatie, Handel, Kampf, Salvage und Expeditionen;
- Respawn oder künstlicher Schutz besiegter Bots;
- administratives Bot-Dashboard;
- vollständige historische Erklärbarkeit jeder verworfenen Option.

Diese Punkte werden erst konkret geplant, wenn ihre gemeinsame Spielermechanik als nächster
spielbarer Schnitt feststeht.
