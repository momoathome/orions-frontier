# Tickets für den beschleunigten Spieltest – Schritt 2

Stand: 29. Juli 2026.

Dieses Ticketpaket konkretisiert ausschließlich
[Schritt 2: Beschleunigter Spieltest](./goal-driven-bots-plan.md#schritt-2-beschleunigter-spieltest).
Es setzt die vollständig abgenommene Zielstrategie aus Schritt 1 voraus. Das Werkzeug ist kein
Produktionsmodus, kein alternativer Gameserver und kein Ersatz für fokussierte Domain- und
Integrationstests.

## Umsetzungsstatus

- [x] PT-01 – Expliziter, seedbarer Ausführungskontext
- [x] PT-02 – Virtuelle Zeit und IDs in Wirtschaft und Stationsaufbau
- [x] PT-03 – Virtuelle Zeit und IDs in Reisen, Kampf und Missionen
- [x] PT-04 – Deterministischer, vollständig drainender Welttakt
- [x] PT-05 – Technisch isolierte, wegwerfbare Playtest-Datenbank
- [x] PT-06 – Seedbarer Welt-Bootstrap mit stabilen Identitäten
- [x] PT-07 – Synthetische Beitritte und Populationsregister
- [x] PT-08 – Typisierte Laufereignisse und kompakte Zustandsproben
- [x] PT-09 – Validierte Runner-Konfiguration und virtuelle Hauptschleife
- [x] PT-10 – Harte Invarianten und kontrollierter Abbruch
- [x] PT-11 – Vollständige Metrikaggregation
- [x] PT-12 – Softlock- und Balancehinweise
- [x] PT-13 – JSON-Bericht, Konsolenausgabe und npm-Einstieg
- [x] PT-14 – End-to-End-, Reproduzierbarkeits- und Laufzeitabnahme
- [x] PT-15 – Mehrseed-Baselines und evidenzbasierte Folgetickets
- [x] Gesamtabnahme für Schritt 2

Abgenommen am 30. Juli 2026 mit drei 24-Stunden-Seeds und einem vollständigen
`npm run verify`. Die Ergebnisse und Folgetickets stehen in
[Playtest-Baseline für Schritt 2](./playtest-baseline.md).

## Zielbild

Ein einzelner CLI-Aufruf erzeugt eine technisch isolierte PostgreSQL-Welt, lässt normale
Bewohner-Bots und nach und nach beitretende synthetische Spieler mit beschleunigter virtueller Zeit
spielen und schreibt anschließend:

- eine kurze, lesbare Konsolenzusammenfassung;
- einen versionierten, maschinenlesbaren JSON-Bericht;
- harte Fehler für gebrochene Spielinvarianten;
- zunächst ausschließlich berichtende Hinweise auf Softlocks und verdächtige Balanceverläufe.

Der Lauf startet keinen Browser, keinen HTTP-Server und keinen Echtzeitscheduler. Alle Aktionen
laufen weiterhin durch die normalen Domain-Services und PostgreSQL-Transaktionen.

## Gemeinsamer Umsetzungsvertrag

Diese Regeln gelten für jedes Ticket:

- Die Playtest-Welt läuft ausschließlich in einem eigenen, wegwerfbaren PostgreSQL-Container ohne
  Host-Port und ohne persistentes Volume. Der Runner verweigert andere Datenbankziele.
- Es gibt keinen beschleunigten Produktionsmodus. Produktionsaufrufe verwenden weiterhin reale
  Zeit, zufällige IDs und den kanonischen Welt-Seed als Defaults.
- Virtuelle Zeit, seedbare IDs und ein abweichender Welt-Seed werden explizit durch die betroffenen
  Service-Einstiegspunkte gereicht. Es gibt keine global umschaltbare Uhr und keinen global
  veränderbaren Zufallsgenerator.
- Synthetische Spieler besitzen normale Spieleraccounts und belegen normale Spielerplätze. Erst
  danach erhalten sie einen normalen `goal_v1`-Controller.
- Bewohner-Bots und synthetische Spieler verwenden dasselbe Bot-Gehirn, dieselben Kosten,
  Sichtbarkeitsregeln, Schutzregeln, Reserven und Domain-Services.
- Der Runner verändert keine Balancingwerte, Schutzdauer, Bot-Gewichte oder Weltregeln.
- PostgreSQL bleibt die Wahrheit. Telemetrie darf Ergebnisse beobachten, aber keine
  Spielzustände reparieren oder direkt erzeugen.
- Harte Invarianten lassen den Lauf fehlschlagen. Softlock- und Balancehinweise bleiben in der
  ersten Version Berichtsdaten und beeinflussen den Exit-Code nicht.
- Bei identischer Konfiguration entstehen dieselben spielrelevanten Entscheidungen und derselbe
  normalisierte Bericht. Reale Laufzeit, Dateipfad und andere Betriebsmetadaten dürfen abweichen.
- Der Runner hält keine vollständige Kopie jedes Welttakts im Speicher. Ereignisse werden
  fortlaufend aggregiert; Diagnosefenster verwenden begrenzte Ringpuffer.
- Generierte JSON-Berichte liegen unter `artifacts/playtests/`, werden nicht versioniert und dürfen
  keine Passwörter, Tokens oder Datenbank-URLs enthalten.
- Eine Schemaänderung erhält die passende SQL-Migration und den Schemaexport. Playtest-spezifische
  Messdaten werden nicht in Produktionstabellen ergänzt, solange ein In-Memory-Aggregat genügt.
- Nach Codeänderungen laufen `npm run check`, der kleinste genannte Test und `npm run verify`.

## Begriffe und feste Anfangswerte

- **Virtueller Zeitpunkt:** Der eine explizite `Date`-Wert, zu dem ein Welttakt ausgeführt wird.
- **Zeitschritt:** Abstand zwischen zwei virtuellen Welttakten. Default: 60 Sekunden.
- **Bewohner-Bot:** Durch die normale Sektorprovisionierung erzeugter Account mit `role = 'bot'`.
- **Synthetischer Spieler:** Normaler Account mit `role = 'player'`, normalem Spieler-Spawn und
  anschließend angelegtem Bot-Controller.
- **Fortschrittsfingerprint:** Kompakter, stabil sortierter Zustand eines Bots aus Stationen,
  Ressourcen, Flotte, Gebäuden, Forschung, aktiven Arbeiten und erreichten Meilensteinen.
- **Normalisierter Bericht:** Bericht ohne reale Laufzeit, Ausgabepfad und zufällige
  Betriebsmetadaten; interne UUIDs sind durch stabile Lauf-Aliase ersetzt.

CLI-Defaults für den ersten Smoke-Lauf:

| Parameter                     | Default                    |
| ----------------------------- | -------------------------- |
| virtueller Start              | `2030-01-01T00:00:00.000Z` |
| Laufdauer                     | 24 virtuelle Stunden       |
| Zeitschritt                   | 60 Sekunden                |
| Beitrittsabstand              | 15 virtuelle Minuten       |
| maximale synthetische Spieler | 12                         |
| Profilgewichte                | je 25 Prozent              |
| Snapshotabstand               | 15 virtuelle Minuten       |

Die Defaults sind Werkzeugkonfiguration, keine Balanceaussage.

## Reihenfolge und Abhängigkeiten

| Ticket | Ergebnis                                                    | Benötigt        |
| ------ | ----------------------------------------------------------- | --------------- |
| PT-01  | Expliziter, seedbarer Ausführungskontext                    | Schritt 1       |
| PT-02  | Virtuelle Zeit und IDs in Wirtschaft und Stationsaufbau     | PT-01           |
| PT-03  | Virtuelle Zeit und IDs in Reisen, Kampf und Missionen       | PT-01, PT-02    |
| PT-04  | Deterministischer, vollständig drainender Welttakt          | PT-02, PT-03    |
| PT-05  | Technisch isolierte, wegwerfbare Playtest-Datenbank         | –               |
| PT-06  | Seedbarer Welt-Bootstrap mit stabilen Identitäten           | PT-01, PT-05    |
| PT-07  | Synthetische Beitritte und Populationsregister              | PT-02, PT-06    |
| PT-08  | Typisierte Laufereignisse und kompakte Zustandsproben       | PT-04, PT-07    |
| PT-09  | Validierte Runner-Konfiguration und virtuelle Hauptschleife | PT-04 bis PT-08 |
| PT-10  | Harte Invarianten und kontrollierter Abbruch                | PT-08, PT-09    |
| PT-11  | Vollständige Metrikaggregation                              | PT-08, PT-09    |
| PT-12  | Softlock- und Balancehinweise                               | PT-08, PT-11    |
| PT-13  | JSON-Bericht, Konsolenausgabe und npm-Einstieg              | PT-09 bis PT-12 |
| PT-14  | End-to-End-, Reproduzierbarkeits- und Laufzeitabnahme       | PT-01 bis PT-13 |
| PT-15  | Mehrseed-Baselines und evidenzbasierte Folgetickets         | PT-14           |

Jedes Ticket hält den normalen API-Betrieb baubar. PT-01 bis PT-04 werden zunächst durch vorhandene
Integrationstests mit expliziten Zeitpunkten abgesichert; der eigentliche Runner wird erst ab PT-09
aufrufbar.

---

## PT-01 – Expliziten, seedbaren Ausführungskontext einführen

### Konkretes Ziel

Zeit, ID-Erzeugung und Welt-Seed können für einen vollständigen Spielablauf explizit vorgegeben
werden, ohne den Produktionsprozess global umzuschalten.

### Feature-Beschreibung

Eine kleine API unter `apps/api/src/lib/game-execution-context.ts` bündelt die drei
Ausführungsabhängigkeiten, die für einen reproduzierbaren beschleunigten Lauf nötig sind.

Vorgesehener Vertrag:

```ts
interface GameExecutionContext {
  now: Date;
  worldSeed: string;
  nextId(namespace: string): string;
  at(now: Date): GameExecutionContext;
}
```

`createRealtimeExecutionContext()` verwendet `new Date()`, `randomUUID()` und
`WORLD_CONFIG.WORLD_SEED`. `createSeededExecutionContext()` verwendet einen festen Startzeitpunkt,
einen Seed und aus `Seed + Namespace + fortlaufendem Zähler` erzeugte gültige UUIDs. `at()` ändert
nur den Zeitpunkt und teilt sich dieselbe deterministische ID-Sequenz.

### Acceptance Criteria

- Es existiert kein globales `setClock`, kein veränderbarer Singleton und keine Abhängigkeit von
  Fake Timers.
- Zwei seedbare Kontexte mit identischem Seed erzeugen dieselbe, namespace-sensible UUID-Folge.
- Unterschiedliche Seeds erzeugen unterschiedliche Folgen.
- `at()` erhält Welt-Seed und ID-Sequenz und ersetzt nur `now`.
- Die generierten IDs sind gültige UUIDs und benötigen keine neue Laufzeitdependency.
- Der Echtzeitkontext behält das bisherige Produktionsverhalten.
- Der Kontext enthält keine Telemetrie- oder Runnerlogik.

### Nötige Umsetzungsinformationen

- Neue Datei: `apps/api/src/lib/game-execution-context.ts`.
- Für die deterministische UUID reicht `node:crypto`; Digest-Bits werden auf ein gültiges
  RFC-4122-UUID-Format gesetzt.
- Der Zähler wird synchron vor einem `await` erhöht. Parallel gestartete Tasks dürfen keine
  Ergebnisreihenfolge zur ID-Zuweisung verwenden.
- Relevante Unit-Tests:
  `apps/api/test/unit/game-execution-context.test.ts`.
- Nicht Teil des Tickets: Domain-Service-Signaturen, Docker, Runner oder Berichte.

---

## PT-02 – Wirtschaft und Stationsaufbau vollständig an den Kontext binden

### Konkretes Ziel

Alle wirtschaftlichen Aktionen, Projektionen und neu erzeugten Stationsdaten verwenden bei einem
Playtest den expliziten virtuellen Zeitpunkt und die deterministische ID-Quelle.

### Feature-Beschreibung

Die betroffenen öffentlichen Service-Einstiegspunkte erhalten einen optionalen
`GameExecutionContext`. Routen und bestehende Aufrufer dürfen ihn weglassen und erhalten intern
einen Echtzeitkontext. Innerhalb eines Aufrufs wird danach weder `Date.now()` noch ein weiteres
`new Date()` als aktuelle Uhr verwendet.

### Acceptance Criteria

- Gebäude- und Verteidigungsausbau berechnen `upgradeEndsAt` relativ zu `context.now`.
- `applyGridOptimization` erhält Start- oder Bezugszeit explizit und verwendet kein `Date.now()`.
- Forschung berechnet `completesAt` relativ zu `context.now`.
- Schiffsbau beginnt seine Queue bei `context.now` und erzeugt stabile Buildorder-IDs.
- Stationsgründung und alle Seedzeilen erhalten den virtuellen Erstellungszeitpunkt; die Station
  erhält eine ID aus `context.nextId('station')`.
- `getStationBuildings`, `getStationDefenseUpgrades` und
  `getDeliveredResourceRates` können einen expliziten Betrachtungszeitpunkt verwenden.
- `executeBotIntent` reicht denselben Kontext an Minerzuweisung, Schiffsbau, Gebäude,
  Verteidigung und Forschung weiter.
- Produktionsrouten benötigen keine neue Request-Eigenschaft und verhalten sich unverändert.
- Ein Integrationstest startet alle vier zeitgebundenen Wirtschaftsarbeiten bei einem weit in der
  Zukunft liegenden virtuellen Zeitpunkt und prüft die exakten Endzeiten und IDs.

### Nötige Umsetzungsinformationen

- Betroffene Services:
  `building.service.ts`, `defense.service.ts`, `research.service.ts`,
  `spacecraft.service.ts`, `station.service.ts`, `station-resource.service.ts` und
  `bot/bot-intent.ts`.
- Seedfunktionen für Ressourcen, Gebäude, Verteidigung und Schiffe erhalten den Kontext nur, wenn
  sie Zeitstempel oder IDs schreiben.
- Datenbank-Defaults bleiben als Sicherheitsnetz für normale SQL-Inserts bestehen; der
  Playtest-Pfad schreibt regel- oder berichtsrelevante Zeitstempel explizit.
- Bestehende Konkurrenztests bleiben unverändert gültig.
- Relevante Tests:
  `apps/api/test/integration/virtual-economy-time.behavior.test.ts` und
  `apps/api/test/integration/write-concurrency.behavior.test.ts`.
- Nicht Teil des Tickets: Reisen, Weltmissionen, Kampf oder der CLI-Runner.

---

## PT-03 – Reisen, Kampf, Bergung und Weltmissionen an den Kontext binden

### Konkretes Ziel

Jede Reise- und Missionskette behält unter beschleunigter Zeit ihre realen Dauern, Schutzfenster,
Cooldowns und kausale Reihenfolge.

### Feature-Beschreibung

Mining, Weltmissionen, Kampf und Bergung erhalten denselben Kontext wie die Botentscheidung. Neu
gestartete Vorgänge beginnen bei `context.now`. Aus einer fälligen Ankunft entstehende Rückwege
beginnen dagegen exakt bei `trip.arrivesAt` beziehungsweise `mission.arrivesAt`, nicht beim
möglicherweise späteren Runner-Tick.

### Acceptance Criteria

- Minerzuweisung, Expedition, Kolonisation, Angriff und Bergung verwenden `context.now` als
  `departedAt`.
- Trips, Assignments, Missionen, Kampfberichte, Trümmer und neu gegründete Kolonien erhalten
  deterministische IDs und explizite logische Erstellungszeitpunkte.
- Angriffsprotektion verwendet den virtuellen Angriffszeitpunkt und den virtuellen
  Account-Erstellungszeitpunkt.
- Kampf- und Vergeltungscooldowns beruhen auf virtuell geschriebenen Kampfzeitpunkten.
- Mining-, Kampf-, Bergungs- und Expeditionsrückwege beginnen am geplanten Ankunftszeitpunkt des
  vorherigen Abschnitts. Große Zeitsprünge verlängern keine Reise.
- `completeDueWorldMissions`, `settleTripArrival` und deren Handler erhalten einen mit
  `context.at(logicalEventTime)` abgeleiteten Kontext.
- Ein durch Kolonisation angelegter Stationszustand trägt den Missionsankunftszeitpunkt.
- `ensureSector` verwendet im Playtest `context.worldSeed`; Produktion bleibt beim kanonischen
  Seed.
- Rückrufzeitpunkte für Miner sind ebenfalls virtuell.
- Integrationstests decken mindestens eine vollständige Mining-, Expeditions-, Kolonisations-,
  Kampf- und Bergungskette mit einem virtuellen Start in der Zukunft ab.

### Nötige Umsetzungsinformationen

- Betroffene Services:
  `mining/assignment.service.ts`, `transport/trip-arrivals.service.ts`,
  `transport/trip-handlers.ts`, `world-mission.service.ts`, `combat.service.ts`,
  `salvage.service.ts`, `sector.service.ts` und `bot/bot-intent.ts`.
- Kind-IDs verwenden getrennte Namespaces wie `trip`, `assignment`, `world-mission`,
  `combat-mission`, `salvage-mission`, `debris` und `sector`.
- Bestehende atomare Claims und `FOR UPDATE`-Sperren werden nicht ersetzt.
- Relevante Tests:
  `apps/api/test/integration/virtual-travel-time.behavior.test.ts`,
  `mining-trip.behavior.test.ts`, `world-mission.behavior.test.ts`,
  `combat.behavior.test.ts` und `trip-arrivals.behavior.test.ts`.
- Nicht Teil des Tickets: Laufereignisse, Bericht oder Softlockanalyse.

---

## PT-04 – Einen deterministischen, vollständig drainenden Welttakt liefern

### Konkretes Ziel

Ein Aufruf verarbeitet alle bis zum virtuellen Zeitpunkt fälligen Arbeiten kausal vollständig und
lässt danach jeden fälligen Bot höchstens einmal entscheiden.

### Feature-Beschreibung

`runWorldTick(context)` wird zum gemeinsamen Orchestrator für Produktion und Playtest. Vor den
Botentscheidungen werden fällige Transporte, Gebäude, Schiffsbauten, Forschung und Weltmissionen
in einer dokumentierten Phasenreihenfolge verarbeitet. Entsteht dabei ein weiterer Vorgang, dessen
Ankunft ebenfalls bereits `<= context.now` liegt, wird erneut drainiert.

### Acceptance Criteria

- Kanonische Reihenfolge:
  Transporte, Gebäude/Verteidigung, Schiffsbau, Forschung, Weltmissionen, danach Bots.
- Innerhalb einer Phase sortieren fälliger Zeitpunkt und anschließend ID stabil.
- Die Completion-Services melden ihre Anzahl zurück.
- Der Orchestrator wiederholt die Completion-Phasen, bis keine weitere fällige Arbeit verarbeitet
  wurde.
- Ein konfigurationsunabhängiges Sicherheitslimit verhindert Endlosschleifen und wirft einen
  aussagekräftigen Fehler mit Zeitpunkt und letzter Phase.
- Pro `runWorldTick` entscheidet jeder zu Beginn oder während des Ticks fällige Bot höchstens
  einmal.
- `runBotDecisionTick` liefert strukturierte Outcomes zurück, ohne seine persistente
  Genau-einmal-Wirkung zu verlieren.
- Der Echtzeitscheduler ruft denselben Orchestrator mit Echtzeitkontext auf.
- Ein Test überspringt mehrere Reiseabschnitte mit einem großen virtuellen Sprung und weist nach,
  dass Rückflug und Lieferung ohne zusätzliche künstliche Minute abgeschlossen werden.
- Parallele normale Scheduleraufrufe bleiben durch die vorhandenen Claims sicher.

### Nötige Umsetzungsinformationen

- Hauptdateien:
  `simulation.service.ts`, `bot/bot.service.ts`, Completion-Services aus PT-03.
- Vorgesehene Rückgaben:
  `SimulationPhaseResult`, `BotDecisionOutcome` und `WorldTickResult`.
- Das Drain-Limit ist eine technische Invariante, kein Balancingwert.
- Relevante Tests:
  `apps/api/test/integration/virtual-world-tick.behavior.test.ts` und
  `trip-arrivals.behavior.test.ts`.
- Nicht Teil des Tickets: Metrikaggregation oder synthetische Spieler.

---

## PT-05 – Eine technisch isolierte, wegwerfbare Playtest-Datenbank bereitstellen

### Konkretes Ziel

Der Playtest kann konstruktionsbedingt weder Entwicklungs- noch Produktionsdaten lesen,
zurücksetzen oder wiederverwenden.

### Feature-Beschreibung

Eine separate `compose.playtest.yaml` definiert ausschließlich einen internen
`playtest-postgres` und einen Runner. PostgreSQL verwendet `tmpfs` statt eines benannten Volumes
und veröffentlicht keinen Port. Ein kleiner Host-Wrapper startet das Compose-Projekt mit einem
eindeutigen Projektnamen und entfernt es in `finally`, auch bei fehlgeschlagenem Runner.

### Acceptance Criteria

- `npm run playtest` verwendet ausschließlich `compose.playtest.yaml`.
- Der PostgreSQL-Service besitzt keinen Host-Port und kein persistentes Volume.
- Datenbankname und Host sind fest als Playtest-Ziel konfiguriert.
- Vor Migration oder Seeding prüft der Runner:
  `PLAYTEST_MODE=1`, erwarteter Host, erwarteter Datenbankname und leere Spieltabellen.
- Eine fehlende oder abweichende Bedingung beendet den Lauf vor jeder schreibenden Operation.
- Der Guard akzeptiert weder `localhost` noch die normale Compose-Datenbank.
- Das Compose-Projekt und sein `tmpfs` werden nach Erfolg und Fehler entfernt.
- Berichte werden als einziges Artefakt über ein enges Host-Verzeichnis herausgegeben.
- Ein Integrationstest beweist, dass der Guard eine normale Test-/Entwicklungs-URL ablehnt.

### Nötige Umsetzungsinformationen

- Neue Dateien:
  `compose.playtest.yaml`,
  `scripts/run-playtest.mjs`,
  `apps/api/src/lib/playtest/database-guard.ts`.
- Der Wrapper darf Docker-Prozesse starten, enthält aber keine Spiellogik.
- Keine `DROP DATABASE`, `TRUNCATE`- oder Reset-Funktion gegen eine übergebene URL implementieren.
- Die normale `compose.yaml` bleibt unverändert nutzbar.
- Nicht Teil des Tickets: Weltaufbau oder Runner-Hauptschleife.

---

## PT-06 – Seedbaren Welt-Bootstrap mit stabilen Identitäten implementieren

### Konkretes Ziel

Eine frische Playtest-Datenbank erhält aus Seed und virtuellem Startzeitpunkt denselben
Ausgangszustand einschließlich aller IDs und Sektorressourcen.

### Feature-Beschreibung

`bootstrapPlaytestWorld(config, context)` führt Migrationen aus und erzeugt die normale initiale
Welt ohne Dev-User oder API-Start. Weltgenerator, Sektoren, Asteroiden, Vorkommen und Spawnslots
verwenden den konfigurierten Welt-Seed und die ID-Quelle des Kontexts.

### Acceptance Criteria

- Der Bootstrap funktioniert nur nach bestandenem PT-05-Guard.
- Es werden keine Dev-Accounts, Admin-Accounts oder vorgefüllten Hochlevelstationen erzeugt.
- Alle initialen Sektor-, Asteroiden-, Vorkommens- und Spawnslot-IDs sind bei gleichem Seed stabil.
- Der virtuelle Startzeitpunkt wird als Erstellungszeit für die initialen Weltzeilen verwendet.
- Laufzeitlich neu entdeckte Sektoren verwenden weiterhin denselben Playtest-Welt-Seed.
- Zwei frische Bootstraps mit identischer Konfiguration besitzen denselben normalisierten
  Welt-Checksum.
- Ein anderer Seed verändert Welt-Checksum oder Ressourcenverteilung.
- Das Bootstrap-Ergebnis meldet Sektor-, Asteroiden-, Spawnslot- und Ressourcenanzahlen.

### Nötige Umsetzungsinformationen

- Neue Dateien:
  `apps/api/src/lib/playtest/bootstrap.ts`,
  `apps/api/src/lib/playtest/world-checksum.ts`.
- Bestehende Funktionen in `seed.ts`, `sector.service.ts` und `world-gen` werden parametrisiert,
  nicht für den Playtest kopiert.
- Der Checksum sortiert semantisch nach Koordinate, Position und Ressourcenschlüssel; UUIDs werden
  nicht als einzige Aussage verwendet.
- Relevanter Test:
  `apps/api/test/integration/playtest-bootstrap.behavior.test.ts`.
- Nicht Teil des Tickets: Spielerbeitritte oder Simulation.

---

## PT-07 – Synthetische Spieler zeitgesteuert beitreten lassen

### Konkretes Ziel

Während des Laufs treten reproduzierbar neue, botgesteuerte Spieler über den normalen
Spieler-Spawnpfad bei.

### Feature-Beschreibung

`joinSyntheticPlayer()` erstellt einen normalen `role = 'player'`-Account, gründet über
`createStation` eine Station auf einem normalen Spielerplatz, wartet auf die normale
Sektor-Botprovisionierung und legt anschließend den `goal_v1`-Controller an. Ein
laufzeitinternes Populationsregister unterscheidet synthetische Spieler und Bewohner-Bots.

### Acceptance Criteria

- Der erste synthetische Spieler tritt bei virtuellem Laufstart bei.
- Weitere Spieler treten im konfigurierten Abstand bei, bis die Populationsgrenze erreicht ist.
- Jeder Spieler belegt atomar einen normalen `player`-Spawnslot.
- Falls ein neuer Settlement-Sektor geöffnet wird, werden dessen Bewohner-Bots über
  `seedBotsForSector` vollständig und abgewartet provisioniert.
- Der Account trägt den virtuellen Beitrittszeitpunkt; der 24-Stunden-Angriffsschutz funktioniert
  dadurch unverändert.
- Profilwahl folgt deterministisch den konfigurierten Gewichten und wird im Register gespeichert.
- Controller starten mit `goal_v1`, der aktuellen Strategieversion und `nextDecisionAt = joinAt`.
- Benutzernamen, E-Mails und deaktivierte Passwortwerte sind seedbar und kollisionsfrei.
- Das Register enthält stabile Aliase, `populationKind`, Profil, Beitritt und initiale Station.
- Bewohner-Bots bleiben `role = 'bot'`; synthetische Spieler bleiben `role = 'player'`.
- Ein Integrationstest lässt genug Spieler beitreten, um einen zweiten Settlement-Sektor zu öffnen,
  und prüft Slots, Profile, Controller und Bewohnerzahl.

### Nötige Umsetzungsinformationen

- Neue Dateien:
  `apps/api/src/lib/playtest/population.ts`,
  `apps/api/src/lib/playtest/profile-distribution.ts`.
- Zu parametrisieren:
  `bot-provision.service.ts`, `station.service.ts`.
- Der Runner ruft keine Auth-Route auf und startet keinen Fastify-Server.
- Nicht Teil des Tickets: künstliche Ressourcen, vorgebaute Flotten oder übersprungener Schutz.

---

## PT-08 – Typisierte Laufereignisse und kompakte Zustandsproben erfassen

### Konkretes Ziel

Alle später benötigten Messwerte sind beobachtbar, auch wenn die zugrunde liegenden Objekte wie
Trümmerfelder oder abgeschlossene Aufträge später verschwinden.

### Feature-Beschreibung

Der Welttakt gibt rein interne, typisierte Ereignisse zurück. Ein Playtest-Collector konsumiert sie
sofort und erstellt zusätzlich in einem konfigurierten Abstand kompakte Datenbank-Snapshots.
Produktionsaufrufer dürfen die Rückgabe ignorieren.

### Acceptance Criteria

- `BotDecisionOutcome` enthält mindestens Bot-Alias/ID, Zeitpunkt, Profil, altes und neues Ziel,
  Aktion, Ergebnisart, Fortschrittsflag und normalisierten Grund.
- Completion-Ereignisse decken Mininglieferung, verworfene Lagermenge, Gebäude,
  Verteidigung, Schiffsbau, Forschung, Weltmission, Kolonie, Kampf, Beute, Verluste,
  Trümmererzeugung und Bergung ab.
- Jedes Completion-Ereignis besitzt eine stabile Ereignis-ID, damit Doppelerfassung erkannt wird.
- Ein Zustands-Snapshot enthält pro Bot und Station nur berichtsrelevante Summen und einen
  Fortschrittsfingerprint, keinen vollständigen ORM-Dump.
- Interne UUIDs werden beim Eintritt in den Collector auf stabile Lauf-Aliase abgebildet.
- Der Collector aggregiert fortlaufend und hält nur begrenzte Diagnosefenster pro Bot.
- Das Beobachten führt keine zusätzlichen Domain-Schreibvorgänge aus.
- Ereignisse entstehen erst nach erfolgreichem atomarem Commit.
- Ein Konkurrenztest weist nach, dass ein genau einmal abgeschlossenes Ereignis auch genau einmal
  gezählt wird.

### Nötige Umsetzungsinformationen

- Neue Dateien unter `apps/api/src/lib/playtest/`:
  `events.ts`, `collector.ts`, `snapshot-loader.ts`, `aliases.ts`.
- Wo ein Service bisher nur `boolean` oder `void` meldet, wird eine kleine Ergebnisstruktur
  ergänzt. Keine persistente Event-Sourcing-Schicht einführen.
- Für Lagerverlust muss die angeforderte und tatsächlich gutgeschriebene Menge vor dem
  Überschreiben des Cargo-Manifests feststehen.
- Relevante Tests:
  `apps/api/test/unit/playtest-collector.test.ts` und
  `apps/api/test/integration/playtest-events.behavior.test.ts`.
- Nicht Teil des Tickets: Auswertungsschwellen oder JSON-Datei.

---

## PT-09 – Runner-Konfiguration und virtuelle Hauptschleife implementieren

### Konkretes Ziel

Ein programmgesteuerter Lauf kann ohne Echtzeitwarten vom virtuellen Start bis zum virtuellen Ende
ausgeführt werden.

### Feature-Beschreibung

Eine validierte Konfiguration steuert Bootstrap, Beitritte, Welttakte, Snapshots und Fortschritts-
ausgabe. Die Hauptschleife erhöht ausschließlich einen lokalen virtuellen Zeitpunkt und ruft pro
Schritt die normalen Services auf.

### Acceptance Criteria

- Konfiguration enthält mindestens:
  Seed, virtuellen Start, Dauer, Schrittweite, Beitrittsabstand, Populationsgrenze,
  Profilgewichte, Snapshotabstand und Ausgabeverzeichnis.
- Konfiguration kann aus CLI-Flags und optional einer JSON-Datei gelesen werden; CLI überschreibt
  Dateiwerte.
- Zod validiert endliche positive Zahlen, ISO-Zeitpunkt, Profilnamen, Gewichtssumme und sinnvolle
  Obergrenzen.
- Schrittweite liegt in Version 1 zwischen 1 und 60 Sekunden.
- Pro Zeitpunkt werden zuerst fällige Beitritte durchgeführt, dann `runWorldTick(context.at(now))`
  und danach gegebenenfalls ein Snapshot.
- Am virtuellen Endzeitpunkt wird ein letzter Welttakt und Snapshot ausgeführt.
- Die Schleife verwendet weder `setTimeout`, `setInterval` noch `sleep`.
- HTTP-App, WebSocket und Echtzeitscheduler werden nicht gestartet.
- Fortschritt erscheint höchstens alle sechs virtuellen Stunden beziehungsweise am Ende.
- Der Runner schließt die DB-Verbindung auch bei Fehlern.
- Ein kleiner Integrationstest durchläuft zwei virtuelle Stunden und weist mehrere Botaktionen und
  mindestens einen synthetischen Beitritt nach.

### Nötige Umsetzungsinformationen

- Neue Dateien:
  `apps/api/src/lib/playtest/config.ts`,
  `apps/api/src/lib/playtest/runner.ts`,
  `apps/api/src/lib/playtest/main.ts`.
- Die Hauptschleife enthält keine Metrikformeln; sie orchestriert Collector und Analyzer.
- Sinnvolle Sicherheitsobergrenzen:
  maximal 365 virtuelle Tage, 10.000 synthetische Spieler und 31.536.000 Ticks.
- Nicht Teil des Tickets: Balanceanpassung oder Dashboard.

---

## PT-10 – Harte Spielinvarianten während des Laufs prüfen

### Konkretes Ziel

Regelverletzungen werden nahe an ihrem Entstehungszeitpunkt erkannt, belegt und führen zu einem
fehlgeschlagenen Lauf.

### Feature-Beschreibung

Ein `PlaytestInvariantAuditor` prüft Ereignisse und gebündelte SQL-Aggregate nach jedem Welttakt.
Bei einem Treffer erzeugt er einen strukturierten Befund und wirft einen
`PlaytestInvariantError`. Der Runner schreibt im `finally` trotzdem einen partiellen Bericht.

### Acceptance Criteria

- Mindestens folgende Invarianten werden geprüft:
  - keine negative Ressource und kein negativer Asteroidenrest;
  - keine negative Flotten- oder Auftragsmenge;
  - `0 <= lockedAmount <= amount`;
  - keine fällige aktive Arbeit bleibt nach dem Drain bei `arrivesAt/endsAt <= now`;
  - keine doppelte Completion-Ereignis-ID;
  - höchstens eine erfolgreiche Botaktion je Bot und Welttakt;
  - Stationsbesitzer ändert sich während eines Laufs nie;
  - erfolgreicher Angriff, Bergung und Mining referenzieren ein im Vorzustand regulär sichtbares
    Ziel;
  - Ressourcen überschreiten nach Gutschrift nicht die Lagerkapazität;
  - aktive Missionen und Trips besitzen ihre notwendigen referenzierten Flotten.
- SQL-Prüfungen sind gebündelt und erzeugen keine Query pro Station.
- Ein Befund enthält Code, virtuellen Zeitpunkt, betroffene Aliase und konkrete Werte.
- Der Exit-Code ist ungleich null.
- Der partielle JSON-Bericht trägt `status = "failed"` und den Befund.
- Integrationstests injizieren je eine negative Ressource, einen ungültigen Lock und eine
  absichtlich überfällige Arbeit in eine Playtest-DB und prüfen den kontrollierten Abbruch.

### Nötige Umsetzungsinformationen

- Neue Dateien:
  `apps/api/src/lib/playtest/invariants.ts`,
  `apps/api/src/lib/playtest/invariant-queries.ts`.
- Der Auditor repariert keine Daten.
- Sichtbarkeitsnachweise stammen aus dem unmittelbar vor der Aktion geladenen Botzustand
  beziehungsweise dem Domain-Ergebnis, nicht aus nachträglichem Raten.
- Nicht Teil des Tickets: Warnschwellen für schlechtes Balancing.

---

## PT-11 – Die vollständige Metrikaggregation umsetzen

### Konkretes Ziel

Der Abschlussbericht beantwortet nachvollziehbar, was die Bots getan haben, wie sie sich
entwickelten und wo Ressourcen oder Fortschritt verloren gingen.

### Feature-Beschreibung

Ein reiner Aggregator verarbeitet PT-08-Ereignisse und Snapshots zu stabil sortierten
Lauf-, Profil-, Bot-, Stations-, Sektor- und Zielmetriken.

### Acceptance Criteria

- Zielmetriken enthalten je Zieltyp und Profil:
  Auswahl, aktive virtuelle Zeit, Wechsel, Abschluss, Erfolg, Fehlschlag, `waiting`, `saving`,
  `blocked` und maximale Bindungsdauer.
- Meilensteine enthalten je Bot, soweit erreicht:
  erstes Mining, stabile Ausgangsstation, drei Moles plus Titan, erste Forschung,
  erste Expedition, erste Kolonie, stabile Kolonie, erste Verteidigung, erster Angriff,
  erste Vergeltung und erste Bergung.
- Wirtschaftsmetriken enthalten:
  abgebaute und gelieferte Ressourcen, gewichteten Durchsatz, Lagerverlust,
  Ressourcenminimum, volle-Lager-Zeit, erschöpfte Asteroiden und unerreichbare Ressourcenbedarfe.
- Entwicklungsmetriken enthalten:
  Gebäude- und Defense-Level, abgeschlossene Forschungen, Flottenbestand, Bauanzahl und
  Queue-Auslastung.
- Expansionsmetriken enthalten:
  Expeditionen, entdeckte Sektoren, Kolonien, Stabilisierungsdauer und Stationszahl.
- Konfliktmetriken enthalten:
  Angriffe, Vergeltungen, Schutzablehnungen, Gewinner, Verluste, Beute,
  angegriffene Zielverteilung und zurückgehaltene Reserve.
- Bergungsmetriken enthalten:
  erzeugte, geborgene und verbleibende Trümmerressourcen, Missionen und Collector-Bauten.
- Weltmetriken enthalten:
  Sektoren nach Rolle, Population nach Typ/Profil, Stationen, Asteroiden und Ressourcenverteilung.
- Summen lassen sich aus Bot-/Stationsdetails auf Profil- und Laufebene nachvollziehen.
- Division durch null, `NaN` und `Infinity` sind im Bericht ausgeschlossen.
- Unit-Tests verwenden kleine handgeschriebene Ereignisfolgen und prüfen jede Metrikfamilie.

### Nötige Umsetzungsinformationen

- Neue Dateien:
  `apps/api/src/lib/playtest/metrics.ts`,
  `apps/api/src/lib/playtest/milestones.ts`,
  `apps/api/src/lib/playtest/aggregator.ts`.
- Prozentwerte werden im JSON als Zahlen `0..1` gespeichert und nur für die Konsole formatiert.
- Dauern werden in Millisekunden oder ISO-8601-Zeitpunkten eindeutig benannt.
- Keine globale Ressourcenpreisökonomie einführen; vorhandene lokale Gewichtungen werden nur
  berichtet.
- Relevanter Test:
  `apps/api/test/unit/playtest-aggregator.test.ts`.

---

## PT-12 – Softlock- und Balancehinweise mit Belegen erzeugen

### Konkretes Ziel

Der Lauf markiert festgefahrene oder auffällige Verläufe, ohne aus einem einzelnen Lauf bereits
harte Balanceurteile abzuleiten.

### Feature-Beschreibung

Ein Analyzer arbeitet ausschließlich auf Collector-Historie und Aggregaten. Jeder Hinweis besitzt
Code, Schwere `warning`, betroffene Aliase, Zeitfenster, Messwerte und eine menschlich lesbare
Erklärung.

Vorläufige, konfigurierbare Defaultfenster:

| Hinweis                       | Default                                       |
| ----------------------------- | --------------------------------------------- |
| kein messbarer Fortschritt    | 6 virtuelle Stunden                           |
| unstabile neue Kolonie        | 6 virtuelle Stunden nach Gründung             |
| identische erfolglose Aktion  | 5 Wiederholungen ohne Fingerprintänderung     |
| ungewöhnlicher Zielwechsel    | mehr als 6 Wechsel in einer virtuellen Stunde |
| permanenter Kapazitätsengpass | 6 virtuelle Stunden                           |
| Profil ohne Kernmeilenstein   | nach 24 virtuellen Stunden aktiver Teilnahme  |

### Acceptance Criteria

- Erkannt werden mindestens alle im Step-2-Plan genannten Fälle:
  lang blockiertes Ziel, kein Fortschritt, unstabile Kolonie, Wiederholung ohne Zustandsänderung,
  Zielchurn, unerreichbare Ressource ohne Expansion, dauerhafte Hangar-/Lager-/Queueblockade,
  Warlord ohne Angriffschance und friedliches Profil ohne wirtschaftliche Entwicklung.
- Fortschritt wird über Fingerprint- oder Meilensteinänderung erkannt, nicht über neue
  Begründungstexte.
- Wiederholungsgründe werden normalisiert; IDs und Zahlen in Freitexten erzeugen keine künstlich
  verschiedenen Gruppen.
- Ein nicht erreichter optionaler Meilenstein ohne vorhandene Chance erzeugt keinen falschen
  Hinweis.
- Hinweise beeinflussen den Exit-Code in Version 1 nicht.
- Jeder Hinweis enthält genug Evidenz, um daraus später ein konkretes Balancingticket zu erstellen.
- Unit-Tests enthalten je Detektor einen positiven und einen negativen Verlauf.

### Nötige Umsetzungsinformationen

- Neue Dateien:
  `apps/api/src/lib/playtest/softlock-analyzer.ts`,
  `apps/api/src/lib/playtest/progress-fingerprint.ts`.
- Ringpuffer speichern nur das längste benötigte Analysefenster plus einen Schritt.
- Schwellen stehen in Playtest-Konfiguration, nicht in `packages/game-config`.
- Relevanter Test:
  `apps/api/test/unit/playtest-softlocks.test.ts`.
- Nicht Teil des Tickets: automatische Gewichtsanpassung oder fehlgeschlagener Build bei Warnungen.

---

## PT-13 – Versionierten JSON-Bericht und kompakte Konsolenausgabe liefern

### Konkretes Ziel

Menschen und nachfolgende Werkzeuge können jeden Lauf schnell beurteilen und vollständig
reproduzieren.

### Feature-Beschreibung

Ein versioniertes Reportschema verbindet Konfiguration, Population, Metriken, Befunde und
Betriebsdaten. Der Bericht wird atomar geschrieben; die Konsole zeigt nur die wichtigsten Zahlen
und Befunde.

### Acceptance Criteria

- Das JSON besitzt `schemaVersion`, `status`, vollständige effektive Konfiguration,
  virtuellen Start/Ende, Welt-Checksum, Strategieversion und Population.
- Metriken aus PT-11 sowie harte und weiche Befunde sind enthalten.
- Reale Laufzeit, Ticks pro Sekunde und maximale beobachtete Populationsgröße sind als
  Betriebsmetriken klar von Spielmetriken getrennt.
- Interne Datenbank-UUIDs erscheinen nicht in öffentlichen Reportfeldern; stabile Aliase reichen.
- Arrays und Objektsammlungen werden stabil sortiert, Fließkommazahlen konsistent gerundet.
- Schreiben erfolgt zuerst in eine temporäre Datei und anschließend per Rename.
- Bei Abbruch wird ein valider partieller Bericht geschrieben.
- Die Konsolenausgabe zeigt:
  Status, Seed, virtuelle Dauer, reale Dauer, Population, Meilensteine je Profil,
  Zielzustände, zentrale Wirtschafts-/Kampfwerte und Befunde.
- Keine Datenbank-URL, Passwortwerte, JWT-Daten oder vollständigen Zustandsdumps gelangen in die
  Ausgabe.
- `artifacts/playtests/` wird in `.gitignore` aufgenommen.
- README dokumentiert Aufruf, Defaults, Artefaktpfad und die Bedeutung von Fehlern versus
  Warnungen.

### Nötige Umsetzungsinformationen

- Neue Dateien:
  `apps/api/src/lib/playtest/report-schema.ts`,
  `apps/api/src/lib/playtest/report-writer.ts`,
  `apps/api/src/lib/playtest/console-summary.ts`.
- Ein Zod-Schema validiert den Bericht vor dem Schreiben.
- Vorgesehener Dateiname:
  `<virtueller-start>-<seed>-<config-hash>.json`.
- Root-Script:
  `npm run playtest -- --seed <seed> ...`.
- Relevante Tests:
  `apps/api/test/unit/playtest-report.test.ts`.
- Nicht Teil des Tickets: HTML, Dashboard oder Upload.

---

## PT-14 – End-to-End-, Reproduzierbarkeits- und Laufzeitabnahme ergänzen

### Konkretes Ziel

Der vollständige Runner ist wiederholbar, beendet sich ohne reale Wartezeit und schützt alle
Schritt-2-Verträge durch automatisierte Checks.

### Feature-Beschreibung

Ein kleiner Smoke-Playtest läuft als Integrationstest gegen die wegwerfbare Datenbank. Zusätzlich
wird derselbe initiale Datenbankzustand zweimal mit identischer Konfiguration ausgeführt und der
normalisierte Bericht verglichen.

### Acceptance Criteria

- Der Smoke-Lauf umfasst mindestens zwei virtuelle Stunden, mehrere Bewohner-Bots,
  mindestens zwei synthetische Spieler, Mining, eine wirtschaftliche Arbeit und Botzielwechsel.
- Der Lauf verwendet keine HTTP-Requests und öffnet keinen Netzwerkport außer der internen
  PostgreSQL-Verbindung.
- Zwei Läufe mit identischem Seed und Ausgangszustand erzeugen denselben normalisierten Bericht.
- Ein anderer Seed verändert Welt-Checksum oder mindestens eine spielrelevante Metrik.
- Der Test prüft, dass keine fälligen Arbeiten und keine offenen DB-Verbindungen zurückbleiben.
- Ein absichtlich gebrochener Invariantenlauf endet ungleich null und schreibt einen Teilbericht.
- Ein Lauf mit nur Softlockwarnung endet erfolgreich.
- Der Bericht enthält keine rohen UUIDs oder Secrets.
- Der Smoke-Lauf berichtet reale Laufzeit und Tickdurchsatz; es entsteht zunächst keine
  hardwareabhängige harte Millisekundengrenze.
- `npm run verify` bleibt vollständig grün.

### Nötige Umsetzungsinformationen

- Neue Tests:
  `apps/api/test/integration/playtest-runner.behavior.test.ts`,
  `apps/api/test/integration/playtest-reproducibility.behavior.test.ts`.
- Für den Vergleich werden Betriebsmetadaten wie reale Laufzeit und Ausgabepfad entfernt.
- Lange Mehrtagesläufe gehören nicht in `npm run verify`.
- Optionales kurzes Kommando:
  `npm run playtest:smoke`.
- Nicht Teil des Tickets: finale Balancegrenzen.

---

## PT-15 – Reproduzierbare Mehrseed-Baselines ausführen und Folgetickets ableiten

### Konkretes Ziel

Schritt 2 endet mit belastbaren Ausgangsdaten statt mit unmittelbar aus einem Einzellauf
veränderten Balancewerten.

### Feature-Beschreibung

Versionierte Konfigurationsdateien definieren eine kurze Entwicklungsbaseline und eine längere
Beobachtungsbaseline. Mehrere Seeds werden nacheinander in jeweils frischen Playtest-Welten
ausgeführt. Nur die zusammengefasste Interpretation wird dokumentiert; große Rohberichte bleiben
Artefakte.

### Acceptance Criteria

- Es existieren mindestens:
  `configs/playtest/smoke.json`,
  `configs/playtest/baseline-24h.json` und
  `configs/playtest/baseline-7d.json`.
- Die erste Abnahme verwendet mindestens drei Seeds und enthält jedes Profil mehrfach.
- Jeder Seed läuft in einer neuen wegwerfbaren Datenbank.
- Ein zusammenfassendes Dokument vergleicht:
  Zielanteile, Meilensteinzeiten, Softlocks, Ressourcenengpässe, Expansion, Konflikt,
  Bergung und Tickdurchsatz.
- Einzelne Ausreißer und seedübergreifende Muster sind getrennt gekennzeichnet.
- Aus jedem priorisierten Problem entsteht ein eigenes Folgeticket mit Messwert, betroffenen
  Profilen/Seeds, erwarteter Verbesserung und erneutem Baseline-Test.
- In PT-15 selbst werden keine Spielgewichte, Kosten, Schutzzeiten oder Weltressourcen geändert.
- Schritt 2 wird in `docs/implementation-plan.md` erst nach grüner technischer Abnahme und
  dokumentierter Mehrseed-Auswertung als abgeschlossen markiert.
- `npm run verify` besteht nach allen Dokumentations- und Runneränderungen.

### Nötige Umsetzungsinformationen

- Neue Dateien:
  `configs/playtest/*.json`,
  `docs/playtest-baseline.md`.
- Rohberichte unter `artifacts/playtests/` werden nicht committet.
- Das Baseline-Dokument nennt Commit, Report-Schema, effektive Konfigurationen und Seeds.
- Ein späteres Balance-Ticket verändert immer nur eine begründete Regelgruppe und vergleicht
  vorher/nachher mit denselben Seeds.

## Gesamtabnahme für Schritt 2

Schritt 2 ist abnahmefähig, wenn:

1. Produktionsbetrieb ohne Playtest-Kontext unverändert Echtzeit und normale Zufalls-IDs verwendet.
2. Der Runner ausschließlich eine technisch isolierte Wegwerf-Datenbank akzeptiert.
3. Virtuelle Zeit durch alle regelrelevanten Starts, Abschlüsse, Schutz- und Cooldownprüfungen
   gereicht wird.
4. Synthetische Spieler normale Spielerplätze und normale Domain-Services verwenden.
5. Gleicher Seed und Ausgangszustand denselben normalisierten Bericht erzeugen.
6. Harte Invarianten fehlschlagen und Softlock-/Balancehinweise zunächst nur berichtet werden.
7. JSON-Bericht und Konsolenzusammenfassung alle vereinbarten Metrikfamilien enthalten.
8. Smoke-, Reproduzierbarkeits-, Unit- und bestehende Integrationstests sowie `npm run verify`
   vollständig bestehen.
9. Mindestens drei Baseline-Seeds ausgewertet wurden, bevor ein Balancewert verändert wird.
