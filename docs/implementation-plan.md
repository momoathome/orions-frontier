# Umsetzungsplan

Dieser Plan führt den bestehenden Orion-Stand zum vereinfachten Idle-Mining-Spiel. Der
Mining-Rundlauf aus Hinflug, Abbau, Rückflug und Lieferung ist spielbar. Der nächste fachliche
Meilenstein ist eine belebte Welt mit ersten wirtschaftlichen Bots. Jeder Bot besitzt wie ein
Spieler eine Station und handelt unter denselben Kosten-, Zeit- und Kapazitätsregeln. Technische
Aufräumarbeiten sind diesem Ziel untergeordnet.

## Leitentscheidung

Der Spieler entscheidet über Ziele und Investitionen. Er wählt Asteroiden, weist Miner zu und baut
Module sowie Einheiten. Ein einmal erteilter Mining-Auftrag läuft selbstständig weiter, bis der
Spieler ihn ändert oder der Asteroid erschöpft ist.

- PostgreSQL bleibt die Quelle der Wahrheit.
- WebSocket und Simulation laufen gemeinsam in der API.
- Ein einfacher Takt verarbeitet ausschließlich in PostgreSQL gespeicherte Fälligkeitszeitpunkte.
- Spieler und Bots besitzen dieselben Stationen, Ressourcen, Schiffe, Bauaufträge und Reisen.
- Ein Bot entscheidet nur, welche reguläre Aktion er als Nächstes versucht. Er erzeugt keine
  Ressourcen oder Schiffe und verkürzt keine Wartezeit.
- Technik wird nur entfernt, wenn sie für den neuen Ablauf ersetzt wurde oder nachweislich
  ungenutzt ist.
- Neue Kataloge, Abstraktionen und Zukunftssysteme entstehen erst aus einem spielbaren Bedarf.

Das fachliche Zielbild steht in [mining-loop.md](./mining-loop.md).

## Bot-Grundsatz

Aus Project Atlas übernehmen wir das Prinzip, dass autonome und vom Spieler beeinflusste Akteure
dieselben Weltregeln durchlaufen. Aus dem alten Project Browsergame können einfache
Entscheidungsprioritäten als Orientierung dienen. Dessen getrennte Rebel-Ressourcen,
Rebel-Raumschiffe und künstliche Ressourcengenerierung werden nicht übernommen, weil sie Bots ein
zweites Wirtschaftssystem geben würden.

Die technische Grenze lautet:

1. Eine Route authentifiziert einen Spieler und ruft eine fachliche Aktion auf.
2. Ein Bot-Entscheider wählt eine Aktion und ruft dieselbe fachliche Aktion mit der Identität seines
   Besitzers auf. Er muss nicht über HTTP gehen.
3. Die fachliche Aktion prüft Eigentum, Sichtbarkeit, Freischaltungen, Ressourcen und Kapazitäten
   und legt dieselben Datenbankeinträge an.
4. Die bestehende Simulation beendet Reisen, Mining-Rundläufe, Bauaufträge und Upgrades anhand
   derselben persistierten Fälligkeitszeitpunkte.

Damit sind die Regeln gemeinsam, obwohl Spieler und Bot ihre Entscheidung über verschiedene
Eingänge treffen. Ein allgemeiner Command-Bus, ein KI-Framework, ein LLM oder ein eigener
Bot-Worker sind dafür nicht erforderlich.

## Phasen

### 1. Ausgangszustand absichern

Status: abgeschlossen am 16. Juli 2026.

- Docker-Start, Build und Typecheck als verlässliche Basis prüfen.
- Verhaltenschecks für einmalige Ereignisverarbeitung, Aufholen nach einem Neustart und
  WebSocket-Authentifizierung ergänzen.
- Den Stand mit `npm run verify` und `npm run test:behavior` reproduzierbar prüfen.

### 2. Mining-Umbau technisch vorbereiten

Status: abgeschlossen am 16. Juli 2026.

Bereits umgesetzt:

- zentrale, validierte Reisezeitberechnung für bestehende Trips und Mining-Prognosen;
- reiner Mining-Rundlauf-Rechner für Abbauzeit, Rundlaufzeit, Lieferleistung,
  Erschöpfungsschätzung und letzte Teilladung;
- ausführbare Tests für die vereinbarten Beispielwerte und mehrere Miner.
- endliche, größenabhängige Asteroidenvorräte in Schema und Weltgenerator;
- transaktionale Beanspruchung bei Ankunft mit Teilbeladung und abgesichertem Konkurrenztest.
- eigenständige Minergruppen mit sichtbarem initialem Hinflug;
- wiederholter Backend-Rundlauf aus Claim, Abbauzeit, beladenem Rückflug und Lieferung bis zur
  vollständigen Erschöpfung.
- serverseitige Mining-Vorschau und erste UI für Restvorrat, Entfernung, Flugzeit, Rundlaufzeit,
  Lieferleistung und Erschöpfungsdauer.
- gruppenbasierter Recall ohne Teleportation: laufende Ladungen werden geliefert, danach endet der
  Auftrag an der Station.
- periodische Mining-/Transport-Ticks, Asteroidenpuffer-Produktion, automatische Selbst-Recalls und
  Transporter-Disposition aus dem Laufzeitpfad entfernt;
- Logistikansicht auf reale Minergruppen, Hinflüge, Abbau/Rückflüge und Restvorräte reduziert.
- Asteroidenpuffer, Yield, Reinheit, Stabilität und Tick-Zeitstempel aus dem Datenmodell entfernt;
- Nomad und Hercules einschließlich alter Flotteneinträge und Bauaufträge entfernt.

Diese Phase ist bewusst auf den betroffenen Ablauf begrenzt. Allgemeines Aufräumen im Monorepo ist
kein eigenes Vorhaben.

1. Den bestehenden Weg von Miner-Zuweisung, Abbau, Asteroidenpuffer, Transport und Gutschrift durch
   API, Datenbank, Jobs und UI vollständig erfassen.
2. Für den heutigen Rundlauf einen kleinen Verhaltenscheck als Sicherheitsnetz festhalten.
3. Berechnungen für Flugzeit, Abbauzeit, Rundlaufzeit und Lieferleistung an einer gemeinsamen,
   seiteneffektfreien Stelle bündeln und direkt testen.
4. Fachliche Zustandswechsel von Queue- und Worker-Aufrufen trennen. BullMQ darf sie weiterhin
   auslösen, aber nicht definieren.
5. Die kleinste Datenmigration für endliche Vorräte und den Miner-Rundlauf festlegen:
   `yieldPerHour` wird zu einer ganzzahligen Restmenge; Stabilität und Reinheit entfallen.
   Bestehende Entwicklungsdaten werden neu erzeugt, statt künstlich aus den alten Raten
   umgerechnet zu werden.
6. Betroffene Altpfade markieren, die mit dem neuen Ablauf gemeinsam entfernt werden:
   Asteroidenpuffer, Transport-Disposition, Förderkapazität und Stabilitätsverschleiß.

Nicht Teil dieser Phase sind der allgemeine Austausch von Bibliotheken, ein neues Domain-Framework
oder ein vollständiger Umbau von Queue und WebSocket.

Abgeschlossen, wenn der neue Ablauf ohne parallelen zweiten Simulationspfad implementiert werden
kann und die zentralen Zeit- und Leistungsberechnungen ausführbar geprüft sind.

### 3. Endlichen Mining-Rundlauf implementieren

Status: abgeschlossen am 16. Juli 2026.

1. Asteroidenadern erhalten `remainingAmount` statt `yieldPerHour`; `stability`, `purity` und
   `purityTier` werden aus Datenbank, API, gemeinsamen Typen, Weltgenerierung und UI entfernt.
2. Der Spieler weist einem Asteroiden einen oder mehrere Miner zu.
3. Jeder Miner durchläuft `Hinflug -> Abbau -> Rückflug -> Lieferung` und beginnt den Rundlauf bei
   bestehendem Auftrag erneut.
4. Die letzte Teilmenge wird korrekt transportiert; der Vorrat kann niemals negativ werden.
5. Gleichzeitig eintreffende Miner und mehrfach ausgelöste Verarbeitung dürfen Ressourcen nur
   einmal abbauen oder gutschreiben.
6. Neustart und Offline-Zeit werden anhand persistierter Fälligkeitszeitpunkte nachgeholt.
7. Der bisherige Transporter- und Puffer-Laufzeitpfad sowie seine ungenutzten Schemafelder und
   Konfigurationswerte für Yield, Reinheit und Stabilität sind entfernt.
8. Recall beendet immer eine vollständige Minergruppe an der Station; Teil-Recall wird erst bei
   einem nachgewiesenen spielerischen Bedarf ergänzt.

Abgeschlossen, wenn ein Asteroid vom ersten Hinflug bis zur vollständigen Erschöpfung ohne
manuelle Zwischenaktion korrekt abgearbeitet wird.

### 4. Mining-Entscheidung im Browser sichtbar machen

Status: abgeschlossen am 16. Juli 2026.

- Asteroid mit Entfernung, Ressourcenarten und Restmengen anzeigen.
- Für den gewählten Miner Geschwindigkeit, Abbaurate und Frachtraum anzeigen.
- Flugzeit, Rundlaufzeit, erwartete Lieferleistung und Erschöpfungszeit vor der Zuweisung berechnen.
- Zugewiesene Miner und ihre sichtbaren Flug-, Abbau- und Rückkehrphasen darstellen.
- Lieferung und Erschöpfung ohne Neuladen aktualisieren.

Abgeschlossen, wenn der Spieler die wirtschaftliche Wirkung eines weiteren Miners vor der
Entscheidung verstehen und den vollständigen Ablauf auf der Karte beobachten kann.

### 5. WebSocket vereinfachen

Status: abgeschlossen am 18. Juli 2026.

- Bestehendes Nachrichtenprotokoll und Frontend-Client weiterverwenden.
- Den `WebSocketServer` an Fastifys HTTP-Server hängen.
- Redis-Publishing durch lokale Ereignisverteilung ersetzen.
- Danach WebSocket-Workspace und separaten Compose-Service entfernen.

Abgeschlossen, wenn Live-Updates ohne separaten WebSocket-Prozess funktionieren.

### 6. Simulation und Scheduler vereinfachen

Status: abgeschlossen am 18. Juli 2026.

- Eine zentrale Simulationsfunktion über datenbankgestützte Fälligkeitszeitpunkte ausführen.
- Beim Start versäumte Vorgänge aus PostgreSQL nachholen.
- Einen einfachen API-internen Takt erproben.
- BullMQ und Redis erst entfernen, wenn dieselben Verhaltenschecks mit dem einfachen Scheduler
  bestehen.

Eine Queue bleibt oder kommt erst zurück, wenn mehrere Prozesse, externe Wiederholungen,
Dead-Letter-Queues oder gemessene Last sie tatsächlich erfordern.

### 7. Verbleibende Anwendung aufräumen

Status: abgeschlossen am 18. Juli 2026.

- Nicht mehr erreichbare Routen, Jobs, Typen und Konfiguration entfernen.
- Docker Compose, README und Workspace-Beschreibung an den tatsächlichen Stand anpassen.
- Weitere Abhängigkeiten nur einzeln und mit erkennbarem Nutzen ersetzen.
- Build, Typecheck, Verhaltenschecks und HMR über den dokumentierten Entwicklungsweg prüfen.

### 8. Gemeinsame Aktionsbasis für Spieler und Bots

Status: abgeschlossen am 20. Juli 2026.

Der konkrete technische und fachliche Ablauf steht in
[Bot-System: konkreter Implementierungsplan](./bot-system.md).

Ziel ist nicht, bestehende Services neu zu entwerfen, sondern die wenigen fachlichen Aktionen so
abzusichern, dass HTTP-Routen und Bots sie gleichermaßen verwenden können.

1. Eigentumsprüfung in den fachlichen Aktionen selbst sicherstellen. Die Mining-Zuweisung macht
   dies bereits; Schiffsbau und Gebäude-Upgrade müssen Station und `userId` ebenfalls gemeinsam
   prüfen. Routen dürfen zusätzlich validieren, sind aber nicht die einzige Schutzschicht.
2. Eine Bot-Identität als normalen Benutzer mit normaler Station anlegen. Nur der Controller-Zustand
   ist bot-spezifisch, zum Beispiel in einer kleinen Tabelle mit `userId`, `nextDecisionAt` und
   zunächst genau einer Strategie. Ressourcen-, Gebäude-, Schiffs- oder Queue-Tabellen werden nicht
   dupliziert.
3. Einen kompakten Stationszustand für Entscheidungen laden: Ressourcen, laufende Bauaufträge,
   Gebäude, verfügbare und gebundene Schiffe, sichtbare Asteroiden, Restmengen, Entfernungen und
   belegte Mining-Slots.
4. Fällige Bot-Entscheidungen im bestehenden API-Prozess verarbeiten. `nextDecisionAt` bleibt in
   PostgreSQL, damit ein Neustart keinen Bot zurücksetzt. Pro Entscheidung darf zunächst höchstens
   eine erfolgreiche Aktion ausgelöst werden.
5. Die Entscheidung bleibt deterministisch und erklärbar. Für die erste Version genügen
   Aktionsname, Ziel und ein kurzer Grund; ein vollständiges Event-Sourcing ist nicht nötig.

Abgeschlossen, wenn ein Spieler und ein Bot mit identischem Ausgangszustand dieselbe fachliche
Aktion durch denselben Service ausführen und dabei identische Kosten, Queue-Einträge und
Fälligkeitszeiten erhalten.

### 9. Ersten wirtschaftlichen Bot spielbar machen

Status: abgeschlossen am 20. Juli 2026.

Die erste Version erhält eine kleine, feste Prioritätsliste statt Persönlichkeitssystem,
Zufallsentscheidungen oder langfristigem Planer:

1. Hat die Station einen freien Miner, wählt der Bot einen sichtbaren, nicht erschöpften Asteroiden
   mit freiem Slot und weist den Miner über `createAsteroidAssignment` zu.
2. Kandidaten werden mit der bereits vorhandenen Rundlauf- und Lieferleistungsberechnung bewertet.
   Benötigte Ressourcen für die nächste Investition erhalten mehr Gewicht; bei Gleichstand sorgt
   eine stabile ID-Sortierung für reproduzierbares Verhalten.
3. Sind alle Miner beschäftigt, kann der Bot über `buildSpacecrafts` einen Mole bauen. Bis eine
   gemeinsame Hangarkapazität existiert, begrenzt ein kleiner strategischer Zielwert das Wachstum
   des ersten Bots; das ist eine Entscheidung des Bots und kein Sondergesetz.
4. Als anschließender vertikaler Schnitt kann er das Shipyard über
   `startBuildingUpgrade` ausbauen und später einen regulär freigeschalteten Titan bauen. Kosten und
   Bauzeiten bleiben unverändert.
5. Mining selbst wird nicht im Bot nachgebaut. Nach der Zuweisung verarbeitet der bestehende
   Rundlauf Hinflug, Claim bei Ankunft, Abbau, Rückflug, Lieferung, Wiederholung und Erschöpfung.

Die Umsetzung erfolgt in drei einzeln prüfbaren Scheiben:

- Bot-Benutzer, Station und Mole anlegen; einen Asteroiden auswählen und regulär abbauen.
- Mit regulär gelieferten Ressourcen einen Mole über die vorhandene Bau-Queue bauen.
- Das Shipyard über die vorhandene Gebäude-Queue ausbauen und einen Titan freischalten.

Damit die Welt tatsächlich belebt wirkt, müssen sichtbare Bot-Stationen und ihre laufenden Reisen
in der Weltansicht erscheinen. Die Chunk-Abfrage liefert derzeit nur Asteroiden und `/me/trips` nur
eigene Reisen. Dafür wird eine sichtbarkeitsgefilterte Weltprojektion für fremde Stationen und
Reisen ergänzt; private Bestände und Aufträge bleiben verborgen.

Abgeschlossen, wenn ein Bot nach einem Neustart weiterhandelt, seine Ressourcen ausschließlich
durch reguläre Lieferungen erhält und ein Spieler Station, Minerflug und Konkurrenz am Asteroiden
beobachten kann.

### 10. Neue Bot-Aktionen nur mit gemeinsamen Spielmechaniken ergänzen

Status: vorgemerkt.

Jede neue Fähigkeit wird zuerst als reguläre Spielermechanik mit serverseitiger Fachaktion gebaut.
Erst danach darf der Bot diese Aktion auswählen. Die voraussichtliche Reihenfolge ist:

1. Hangarplätze als gemeinsame harte Flottengrenze für Spieler und Bots.
2. Scanner und Entdeckung als gemeinsame Sichtbarkeitsregel.
3. Kampfauftrag, Flug, Auflösung, Verluste, Beute und Stationsverteidigung.
4. Wracks beziehungsweise Trümmerfelder und ein regulärer Salvage-Auftrag.
5. Einfluss, Stationsübernahme und später mehrere Stationen pro Akteur.
6. Weitere tatsächlich wirksame Module wie Warehouse, Guardian, Core und Laboratory.

Persönlichkeiten wie wirtschaftlich, defensiv oder aggressiv bestehen später nur aus anderen
Prioritäten und Zielwerten über diesen gemeinsamen Aktionen. Sie erhalten keine abweichenden
Kosten, Erträge oder Einheiten. Kampf-, Salvage- und Defense-Entscheidungen werden nicht vor ihren
Spielermechaniken simuliert.

Für die Bot-Phasen werden mindestens folgende Verhaltenschecks ergänzt:

- Bots können Eigentum, Sichtbarkeit, Freischaltungen, Ressourcen und Mining-Slots nicht umgehen.
- Ein fälliger Entscheidungszeitpunkt löst höchstens eine erfolgreiche Aktion aus und wird
  restart-sicher fortgeschrieben.
- Derselbe Mining-Auftrag erzeugt für Spieler und Bot dieselben Trips und Lieferungen.
- Konkurrierende Spieler und Bots beanspruchen Restmengen erst bei Ankunft und können sie nicht
  doppelt abbauen.
- Ohne gültige Aktion bleibt ein Bot untätig und erhält keinen Ausgleich aus einem Sonderpfad.

### 11. Kapazität und Werte abstimmen

Status: offen; letzter geplanter Schritt.

Dieser Schritt bleibt bewusst der letzte, weil seine Werte über längere Zeit anhand echter
Spielerfahrung angepasst werden.

- Vorratsgrößen so festlegen, dass der frühe Spielfluss auch über Nacht sinnvoll bleibt.
- Startflotte und erste Minerwerte auf nachvollziehbare Entscheidungen prüfen.
- Die zuvor eingeführten Hangarplätze anhand echten Wachstumsverhaltens abstimmen.
- Hydrogenium-Verbrauch von Mining-Aufträgen nur ergänzen, wenn er eine verständliche Entscheidung
  erzeugt und nicht bloß eine weitere laufende Zahl ist.

Abgeschlossen, wenn der frühe Mining-Ausbau weder sofort erschöpft noch dauerhaft wartungsfrei ist.

## Arbeitsweise

Es wird nur die jeweils nächste Phase detailliert. Jede Phase hinterlässt einen lauffähigen Stand.
Der erste Bot wird als vertikaler Schnitt gebaut; allgemeines technisches Aufräumen und weitere
Bot-Fähigkeiten folgen dem nachgewiesenen Bedarf und laufen ihm nicht voraus.
