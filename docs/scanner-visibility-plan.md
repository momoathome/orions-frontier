# Scanner, Radar und räumliche Sichtbarkeit

Stand: 22. Juli 2026. Der Umbau ist vollständig umgesetzt. Dieses Dokument ist zugleich fachlicher
Vertrag, Architekturübersicht und Abnahmenachweis.

## Ziel

Sichtbarkeit wird ausschließlich räumlich bestimmt. Jede Station erzeugt entsprechend ihrem eigenen
Scannerlevel einen kreisförmigen Erfassungsbereich in Weltkoordinaten. Der Spieler sieht die
Vereinigung der Erfassungsbereiche aller eigenen Stationen.

Sektoren sind keine Sichtbarkeits- oder Berechtigungsgrenze. Sie bleiben persistente Container für
Weltgenerierung, Objektzuordnung und die Erweiterung des gemeinsamen Universums.

## Verbindliche Regeln

Für einen Punkt `p` und die eigenen Stationen `s` gilt:

```text
sichtbar(p) = eigenes Objekt
              oder es existiert eine eigene Station s mit
              (p.x - s.x)² + (p.y - s.y)² <= scannerRange(s)²
```

- Die Kreisprüfung erfolgt serverseitig mit Welt-Units, nicht mit Sektor- oder Chunkabständen.
- Jede Station verwendet ausschließlich ihr eigenes Scannerlevel.
- Mehrere Scanner bilden eine Vereinigungsmenge; überlappende Bereiche verstärken sich nicht.
- Eigene Stationen, Schiffe und laufende Missionen bleiben unabhängig von der Abdeckung sichtbar.
- Fremde statische und bewegte Objekte sind nur während tatsächlicher Scannerabdeckung sichtbar.
- Ein Objekt auf der Kreisgrenze gilt als sichtbar.
- Berechtigungsprüfungen verwenden dieselbe Regel wie Kartenabfragen; eine bekannte UUID umgeht das
  Radar nicht.
- Außerhalb der Sichtbarkeit antworten Detail- und Aktionsendpunkte mit `NOT_FOUND`, damit die
  Existenz eines Objekts nicht verraten wird.
- `hiddenLevel` wird entfernt und nicht für die Entfernungslogik wiederverwendet.

### Scannerreichweite

Die erste Balancing-Baseline ist bewusst linear:

```text
Level 0:     0 Units
Level 1: 2.000 Units
je Level: +500 Units
Level 15: 9.000 Units
```

Die Formel liegt ausschließlich in `@orions-frontier/game-config`. Der Building-Effekt wird von
`scanner_strength` in `scanner_range` umbenannt. API, Bots und UI beziehen denselben berechneten
Wert; es gibt keine zweite Formel in SQL oder im Frontend.

Die Werte sind ein Balancing-Knopf. Die Architektur darf nicht von den konkreten Zahlen abhängen.

## Sichtbarkeit nach Objekttyp

| Objekt                  | Fremd/neutral                         | Eigen           | Öffentliche Daten innerhalb des Radars                  |
| ----------------------- | ------------------------------------- | --------------- | ------------------------------------------------------- |
| Asteroid                | nur im Scannerkreis                   | nicht anwendbar | Position, Größe, Adern und Restmengen                   |
| Station                 | nur im Scannerkreis                   | immer           | Name, Position, Besitzerart                             |
| Trümmerfeld             | nur im Scannerkreis                   | nicht anwendbar | Position und verwertbare Ressourcen                     |
| Raumflug                | aktuelle Position nur im Scannerkreis | immer           | Signatur, Bewegungsrichtung; keine entfernten Endpunkte |
| Mining-Gruppe           | aktuelle Position nur im Scannerkreis | eigene immer    | wie Raumflug                                            |
| Expedition/Kolonisation | aktuelle Position nur im Scannerkreis | eigene immer    | wie Raumflug                                            |

Ein Auftrag darf zunächst jedes Objekt verwenden, das durch irgendeine eigene Station sichtbar ist.
Der Auftrag muss nicht von genau der Station starten, deren Scanner das Ziel erfasst. Die Information
wird innerhalb des eigenen Stationsnetzes geteilt; Entfernung und Reisezeit bleiben die Kosten.

Verliert ein Spieler später eine Station und damit Abdeckung, laufen bereits gestartete eigene
Aufträge weiter. Eigene Schiffe und Missionsdaten bleiben sichtbar, neutrale Zielobjekte werden auf
der Weltkarte jedoch wieder verborgen.

## Zentrale Backend-Struktur

Die Umsetzung verwendet genau einen Domain-Service, `scanner-visibility.service.ts`. Er
enthält keine objektspezifischen Datenbankabfragen, sondern nur die gemeinsame Regel:

- `getUserScannerCoverages(userId, db?)` lädt `stationId`, Mittelpunkt und lokale Reichweite aller
  eigenen Stationen;
- `isPointVisible(coverages, point)` führt die exakte quadrierte Kreisprüfung ohne Quadratwurzel aus;
- `visibleCoverageBounds(coverages, requestedBounds)` liefert die mit dem Kameraausschnitt
  geschnittenen Bounding-Boxes;
- `assertPointVisible(...)` beziehungsweise ein kleines gemeinsames Ergebnisformat schützt
  Detail- und Aktionsendpunkte.

Objektservices bleiben für ihre Daten verantwortlich. Sie erhalten die vorbereitete Abdeckung oder
rufen den zentralen Service einmal auf. Es entstehen keine separaten Asteroiden-, Trümmer- oder
Flottenvarianten der Distanzformel.

## Datenbank- und Abfragestrategie

### Statische Objekte

Asteroiden, Stationen und Trümmer werden in zwei Stufen gefiltert:

1. **Grobe Eingrenzung in PostgreSQL:** Kamera-Chunkbereich geschnitten mit den quadratischen
   Bounding-Boxes der Scannerkreise.
2. **Exakte Prüfung im API-Prozess:** quadrierte Distanz gegen die wenigen eigenen Stationen.

Damit liefert die Datenbank nur räumlich plausible Kandidaten. Die Kreisprüfung im Prozess vermeidet
eine duplizierte Scannerformel in SQL und entfernt lediglich die Ecken der Bounding-Boxes. Eine
Bounding-Box enthält höchstens rund 27 Prozent mehr Fläche als ihr Kreis.

Der API-Ablauf für `/world/chunks` ist:

1. authentifizierten Kamera-Chunkbereich validieren;
2. Scannerabdeckungen einmal laden;
3. jede Scanner-Bounding-Box mit dem Kameraausschnitt schneiden;
4. bei leerer Schnittmenge ohne Objektabfrage `{ asteroids: [], stations: [], debris: [] }` liefern;
5. eine SQL-Bedingung aus `viewport AND (coverageBox1 OR coverageBox2 ...)` erzeugen;
6. Kandidaten laden und serverseitig exakt filtern;
7. Ergebnisse wie bisher nach Chunk an den Client liefern.

Für die erwartete kleine Zahl eigener Stationen ist das kürzer und günstiger als PostGIS oder eine
zusätzliche räumliche Tabelle. Sollten Spieler später Dutzende Stationen besitzen, wird erst nach
Messung auf eine parametrisierte `VALUES`-CTE mit Coverage-Zeilen umgestellt.

### Indizes

Folgende Indizes werden verwendet beziehungsweise ergänzt:

- Asteroiden: bestehend `(chunk_x, chunk_y)`;
- Trümmerfelder: bestehend `(chunk_x, chunk_y)`;
- Stationen: `chunk_x` und `chunk_y` ergänzen und `(chunk_x, chunk_y)` indexieren;
- Scannerabdeckung: bestehend `stations(user_id)` plus die eindeutige Kombination
  `station_buildings(station_id, building_key)`;
- aktive normale Reisen: partieller Index auf `arrives_at` mit `WHERE status = 'traveling'`;
- aktive Weltmissionen: bestehender Index `(status, arrives_at)` ist ausreichend.

Die Stations-Chunkkoordinaten werden beim Erzeugen gesetzt. Stationen bewegen sich derzeit nicht;
es gibt daher keinen Synchronisationspfad für Positionsänderungen.

Ein GiST-Index, PostgreSQL-`point`, PostGIS und ein eigener Spatial-Index werden zunächst nicht
eingeführt. Sie kommen nur infrage, wenn reale `EXPLAIN ANALYZE`-Messungen zeigen, dass Chunk- und
Bounding-Box-Filter nicht mehr genügen.

### Detail- und Aktionsabfragen

Detailzugriffe laden das Ziel über seinen Primärschlüssel und prüfen anschließend dessen Punkt gegen
die Scannerabdeckungen. Das ist für einzelne IDs schneller und einfacher als eine räumliche
Unterabfrage.

Die Prüfung wird mindestens auf folgende Pfade angewendet:

- Asteroidendetail, Mining-Preview und Mining-Zuweisung;
- Trümmerdetail und Start einer Bergungsmission;
- fremde Stationsinformationen, Angriff, Einfluss und Übernahme;
- alle späteren Aktionen, deren Ziel über eine Weltobjekt-ID adressiert wird.

Die Prüfung findet unmittelbar vor dem Anlegen eines Auftrags erneut statt. Sichtbarkeit aus einer
älteren Kartenantwort ist keine Berechtigung.

### Bewegte Objekte

Die Position einer Reise ist zeitabhängig. Ein räumlicher Index auf Start- oder Zielposition löst
dieses Problem nicht. Deshalb erfolgt der Umbau gestuft.

Für die erste Version werden `fromX`, `fromY`, `toX` und `toY` beim Erzeugen einer
`spacecraft_trip` zusätzlich gespeichert. Dadurch entfallen bei jeder Radaraktualisierung die
aktuellen polymorphen Stations-, Asteroiden- und Trümmerabfragen. Die Position wird einmal pro
Antwort aus Zeitfortschritt und diesen Koordinaten berechnet.

Die Abfrage liest nur `status = 'traveling'` über den partiellen Index. Danach werden die aktuellen
Positionen gegen Kamera und Scannerkreise geprüft. Eigene Reisen werden unabhängig davon ergänzt.
Weltmissionen bleiben vorerst in ihrer bestehenden Tabelle, da ihre aktive Anzahl klein ist; ihre
Position wird mit derselben reinen Interpolationsfunktion berechnet.

Es werden keine aktuellen Positionen jede Sekunde in die Datenbank geschrieben. Das würde den
bisher schreibarmen Reiseablauf unnötig in eine fortlaufende Update-Last verwandeln.

Erst wenn mindestens eines der folgenden Kriterien dauerhaft überschritten wird, wird eine
materialisierte aktuelle Chunkposition eingeführt:

- mehr als 10.000 gleichzeitig aktive Reisen;
- `GET /world/trips` über 100 ms p95 trotz partiellen Indexes;
- das Scannen der aktiven Reisen verursacht in `EXPLAIN ANALYZE` den dominanten Anteil der
  API-Latenz.

Dann aktualisiert der bestehende Simulationstakt `current_x`, `current_y`, `current_chunk_x` und
`current_chunk_y` in Batches; ein partieller Index auf aktive aktuelle Chunks ermöglicht dieselbe
Abfrageform wie bei statischen Objekten. Dieser Ausbau ist ausdrücklich kein Teil der ersten
Implementierung.

## API-Verträge und Informationsschutz

### Scannerabdeckung

`GET /stations` liefert für jede eigene Station zusätzlich `scannerRange`. Der Client zeichnet
daraus die tatsächlichen Kreise. Der aktive Stationskreis wird hervorgehoben, weitere eigene Kreise
werden schwächer dargestellt.

Die Serverantwort ist maßgeblich. Das Frontend berechnet die Reichweite nicht selbst aus dem Level.

### Statische Weltobjekte

`GET /world/chunks` behält seine Form bei. Es liefert nur noch Objekte in der Scannerabdeckung. Eine
beliebig verschobene Kamera kann dadurch keine entfernten Inhalte abrufen.

Asteroiden- und Trümmerdetails werden weiterhin über IDs geladen, jedoch mit derselben
Sichtbarkeitsprüfung. Bestehende UI-Auswahl wird geschlossen, wenn ein Refresh das Objekt nicht mehr
liefert oder der Detailabruf `NOT_FOUND` zurückgibt.

### Eigene Reisen und fremde Radarkontakte

Der bisherige Vertrag verrät bei fremden Reisen Start und Ziel. Er wird in zwei Formen getrennt:

- **Eigene Reise:** vollständige Route, Zeitstempel, Zweck und Gruppengröße;
- **Fremder Radarkontakt:** aktuelle Position, Beobachtungszeit, Bewegungsvektor, grobe
  Schiffssignatur und zunächst keine exakte Gruppengröße.

Der Kontakt enthält keine entfernten Start-/Zielkoordinaten, keine Fracht, keine Assignment-ID und
keinen Missionsbesitzer. Der Bewegungsvektor erlaubt dem Client eine kurze Interpolation zwischen
den bestehenden Fünf-Sekunden-Aktualisierungen. Der Client maskiert Kontakte zusätzlich an den
bekannten Scannerkreisen; der Server bleibt dennoch die Berechtigungsgrenze.

## Sektoren und Frontier

Sektoren bleiben global und gemeinsam:

```text
Datensatz vorhanden     = Region wurde erzeugt
Datensatz nicht vorhanden = unbekannte, noch nicht erzeugte Frontier
```

Es gibt keine `user_discovered_sectors`-Tabelle. Sektorkoordinaten und Rollen sind öffentliche
strategische Metadaten; Asteroiden, Stationen, Trümmer und Bewegungen darin unterliegen trotzdem dem
Radar.

Die Frontier-Logik wird von der Scannerreichweite entkoppelt:

- eine Expedition darf einen nicht existierenden Sektor an der globalen Grenze anfliegen;
- Entfernung und Reisezeit begrenzen die Auswahl;
- bei Ankunft wird der Sektor weiterhin idempotent erzeugt;
- Kolonisation verwendet existierende Frontier-Sektoren, nicht deren momentane Radarinhaltssicht;
- `getDiscoveredSectors` wird fachlich in eine Abfrage für erzeugte beziehungsweise kolonisierbare
  Sektoren umbenannt.

Die Berechnung unbekannter Randkoordinaten lädt nicht mehr alle Sektoren in den API-Prozess.
PostgreSQL erzeugt pro existierendem Sektor seine vier orthogonalen Nachbarn über `VALUES`, entfernt
existierende Koordinaten per `NOT EXISTS`, sortiert nach Entfernung zur Ursprungsstation und liefert
nur die nächsten 32 Ziele. Der eindeutige Index auf `(sector_x, sector_y)` deckt die Existenzprüfung
ab. Eine zusätzliche Frontier-Tabelle ist nicht erforderlich.

## Umgesetzte Phasen

### Phase 1: Gemeinsamer Scannerkern und Asteroiden — abgeschlossen

1. `scanner_range` und die lineare Range-Formel in der Spielkonfiguration einführen.
2. Stationsbezogene Abdeckungen und reine Geometriefunktionen implementieren.
3. `hiddenLevel` aus Typen, Schema, Generator, Fixtures, Filtern und Bot-State entfernen.
4. Migration zum Entfernen von `asteroids.hidden_level` anlegen.
5. Asteroiden in `/world/chunks` über Coverage-Bounds plus exakten Kreis filtern.
6. Detail, Mining-Preview und Assignment mit derselben Prüfung schützen.
7. Bots auf den Scanner ihrer eigenen Station umstellen; bei mehreren Botstationen dieselbe
   Vereinigungsregel verwenden.
8. `scannerRange` für eigene Stationen ausliefern und Scannerkreise auf der Karte zeichnen.
9. Nach Scannerupgrade sichtbare Chunks und offene Details neu laden.

**Abnahme:** Außerhalb aller eigenen Scannerkreise ist ein Asteroid weder auf der Karte noch per
UUID oder Mining-Endpunkt erreichbar. Ein Asteroid auf der Kreisgrenze ist erreichbar.

### Phase 2: Stationen und Trümmerfelder — abgeschlossen

1. Stationen um persistente Chunkkoordinaten und den zusammengesetzten Chunkindex ergänzen.
2. Fremde Stationen in `/world/chunks` über dieselbe Abdeckung filtern; eigene Stationen bleiben
   sichtbar.
3. Stationsdetail-, Einfluss-, Angriffs- und Übernahmeaktionen gegen Sichtbarkeit absichern.
4. Trümmerlisten und -details räumlich filtern.
5. Bergungsaufträge nur zu aktuell sichtbaren Trümmern zulassen.
6. Bei Stationsübernahme Coverage und sichtbare Chunks für beide betroffenen Spieler invalidieren.

**Abnahme:** Direkte IDs umgehen weder Stations- noch Trümmersichtbarkeit. Ein Trümmerfeld wird beim
Verlassen aller Scannerkreise entfernt und bei erneuter Abdeckung wieder geladen.

### Phase 3: Flotten, Miner und Weltmissionen — abgeschlossen

1. Start- und Zielkoordinaten in neuen normalen Reisen denormalisiert speichern und bestehende
   aktive Reisen migrieren oder in der Entwicklungswelt neu erzeugen.
2. Eine gemeinsame, reine Funktion für die aktuelle Reiseposition verwenden.
3. eigenen Reisevertrag und fremden Radarkontakt trennen.
4. fremde normale Reisen nach ihrer aktuellen Position filtern.
5. Expeditionen und Kolonisationsmissionen nach derselben Regel projizieren.
6. Route, Fracht, Assignment und genaue Gruppengröße aus fremden Kontakten entfernen.
7. Frontend-Layer auf vollständige eigene Reisen plus kurz interpolierte Radarkontakte umstellen.
8. Kontakte beim Eintritt in den Kreis anzeigen und beim Austritt spätestens mit dem nächsten
   Fünf-Sekunden-Refresh entfernen.

**Abnahme:** Eine fremde Flotte ist nur während ihres tatsächlichen Aufenthalts in mindestens einem
Scannerkreis sichtbar. Ihre Darstellung verrät keine Route außerhalb der Abdeckung. Eigene Reisen
bleiben vollständig sichtbar.

### Phase 4: Sektor- und Frontier-Bereinigung — abgeschlossen

1. Scanner-Sektorradius und `isWithinScannerRange` vollständig entfernen.
2. Sektorendpunkte und Typen auf öffentliche Weltmetadaten beziehungsweise Kolonisationsziele
   umbenennen.
3. unbekannte Frontier-Ziele begrenzt und indexgestützt in SQL bestimmen.
4. Expedition und Kolonisation von Objekt-Radarsichtbarkeit entkoppeln.
5. Frontendtexte von „discovered sector“ auf „generated/known region“ beziehungsweise passende
   Spielbegriffe umstellen.
6. Weltgenerierungsdokumentation an das technische Container-Modell anpassen.

**Abnahme:** Neue Sektoren entstehen weiterhin ausschließlich durch Expeditionen. Ihre Existenz
macht ihre Inhalte nicht automatisch sichtbar.

### Phase 5: Messung und Härtung — abgeschlossen

1. strukturierte Messwerte für geladene Coverage-Zonen, SQL-Kandidaten und ausgelieferte Objekte
   ergänzen;
2. Testwelt mit mindestens 100.000 Asteroiden, 10.000 Trümmerfeldern, 5.000 Stationen und 10.000
   aktiven Reisen erzeugen;
3. relevante Abfragen mit `EXPLAIN (ANALYZE, BUFFERS)` prüfen;
4. sicherstellen, dass statische Weltabfragen keinen vollständigen Tabellenscan verwenden;
5. lokal als Zielwerte weniger als 50 ms p95 für `/world/chunks` und weniger als 100 ms p95 für
   `/world/trips` unter der Testlast anstreben;
6. erst bei verfehlten Zielwerten die im Abschnitt „Bewegte Objekte“ beschriebene Materialisierung
   oder eine `VALUES`-CTE einführen.

Der reproduzierbare Bericht läuft mit `npm run scanner:report`. Er erzeugt ausschließlich temporäre
Tabellen mit den produktiven Indexstrukturen und verwirft sie beim Trennen der Datenbankverbindung.
Der Abnahmelauf vom 22. Juli 2026 ergab:

| Projektion                | Datenmenge    | Ausführung | Kandidatenzugriff      |
| ------------------------- | ------------- | ---------- | ---------------------- |
| Asteroiden                | 100.000       | 0,273 ms   | indexgestützt          |
| Trümmer                   | 10.000        | 0,060 ms   | indexgestützt          |
| Stationen                 | 5.000         | 0,050 ms   | indexgestützt          |
| aktive Reisen             | 10.000        | 1,577 ms   | bewusster aktiver Scan |
| fällige Reiseverarbeitung | 10.000 aktive | 0,030 ms   | partieller Index       |

Die Werte sind lokale Einzelmessungen und keine Produktions-SLA. Der Bericht prüft die Grenzwerte
und schlägt fehl, sobald statische Kandidatenabfragen oder die Fälligkeitsabfrage auf einen
vollständigen Scan zurückfallen. Der aktive Reisescan bleibt bis zu den oben definierten
Materialisierungsschwellen bewusst erlaubt.

## Tests

### Unit-Tests

- Kreisprüfung innen, außen und exakt auf der Grenze;
- negative Weltkoordinaten;
- zwei getrennte und zwei überlappende Stationskreise;
- stationseigene Reichweite statt maximalem Spielerlevel;
- Scannerformel für Level 0, 1 und 15;
- deterministische Reiseinterpolation vor Abflug, während des Flugs und bei Ankunft.

### Integrationstests

- Kameraabfrage außerhalb aller Scannerbereiche liefert keine neutralen/fremden Objekte;
- ein stärkerer Scanner einer anderen eigenen Station verändert nicht den Radius der ersten Station;
- Asteroidenliste, Detail, Preview und Assignment besitzen dieselbe Grenze;
- Bot und Spieler verwenden dieselben Regeln;
- Stationen, Trümmerdetails, Bergung, Angriff, Einfluss und Übernahme sind gegen UUID-Zugriff
  geschützt;
- fremde Reise tritt in einen Scannerkreis ein und verlässt ihn wieder;
- fremder Kontakt enthält keine Endpunkte, Fracht oder genaue Gruppengröße;
- eigene Reise bleibt außerhalb aller eigenen Kreise sichtbar;
- Sektorentstehung bleibt global, während dessen Inhalte räumlich verborgen bleiben;
- Scannerupgrade löst einen Kartenrefresh mit der neuen lokalen Reichweite aus.

### Regression und Abnahme

Jede Phase endet mit `npm run verify`. Datenbankpläne werden zusätzlich manuell gegen die große
Testwelt geprüft; Laufzeitbudgets werden nicht als flakey CI-Zeitmessung implementiert.

## Reihenfolge der Migrationen

1. neue Scannerformel und Backend-Service einführen, während `hiddenLevel` noch gelesen werden kann;
2. Asteroidenpfade vollständig auf räumliche Sichtbarkeit umstellen;
3. `hiddenLevel` aus Schema und Datenbank entfernen;
4. Stations-Chunks und Reiseendpunktkoordinaten hinzufügen und zurückfüllen;
5. statische Objekte und danach bewegte Kontakte umstellen;
6. alte Sektorreichweite und nicht mehr verwendete API-Felder entfernen.

Es wird keine lange Kompatibilitätsschicht zwischen den Modellen gepflegt. Die Welt ist noch nicht
produktiv; falls das Zurückfüllen aktiver Entwicklungsreisen aufwendiger als ein Reset ist, wird die
lokale Entwicklungswelt neu erzeugt.

## Definition of Done

Der Umbau ist abgeschlossen, wenn:

1. alle neutralen und fremden Weltobjekte dieselbe stationenbezogene Kreisregel verwenden;
2. keine Objekt-ID und kein Aktionsendpunkt die Regel umgehen kann;
3. eigene Assets unabhängig von Radarabdeckung bedienbar bleiben;
4. fremde Bewegungsdaten keine Information außerhalb des Scannerkreises verraten;
5. Sektoren nur noch Weltcontainer und Expansionsgrenze sind;
6. `hiddenLevel`, globale Scannerstärke und Scanner-Sektorradius entfernt sind;
7. statische Abfragen vorhandene Chunkindizes nutzen und die definierten Lastmessungen bestehen;
8. Backend, Frontend, Bots, Dokumentation und Verhaltenstests denselben Vertrag abbilden;
9. `npm run verify` erfolgreich ist.

## Bewusst vertagt

- Tarnung, Sensorsignaturen und unterschiedliche Erkennungsqualität;
- gemeinsame Radarfreigabe zwischen verbündeten Spielern;
- historische Kontakte oder ein persistentes Radarlog;
- Radarstörungen, Nebel und sektorabhängige Modifikatoren;
- PostGIS oder eine eigene Spatial-Infrastruktur;
- sekundengenaue persistierte Positionen aller Flotten.

Diese Erweiterungen erhalten erst dann eigene Datenmodelle, wenn die Grundmechanik spielbar und
gemessen ist.
