# Weltgenerierung und persistente Frontier

Status: Umsetzungsschritte 1 bis 11, der technische Aufräumschnitt und die erste messbare
Balancing-Baseline wurden am 21. Juli 2026 abgeschlossen. Weitere Wertänderungen benötigen reale
Spielverläufe.

Dieses Dokument beschreibt die dauerhaft wachsende Onlinewelt mit endlichen Asteroiden. Der
Mining-Rundlauf selbst ist in
[mining-loop.md](./mining-loop.md) festgelegt. Hier geht es ausschließlich um die räumliche
Verteilung, neue Spieler, Bots, Sektorerschöpfung, Exploration und Kolonisation.

## Zielbild

- Asteroiden besitzen endliche Vorräte und werden nach ihrer vollständigen Abwicklung entfernt.
- Abgebaute Asteroiden erscheinen nicht automatisch erneut.
- Stationen bleiben an ihrem Standort.
- Ein alter Sektor darf wirtschaftlich ärmer werden.
- Neue Ressourcen werden zunächst durch die gemeinsame Erkundung weiterer Sektoren erschlossen.
- Neue Spieler erhalten eine frische Startertasche, aber keine private Parallelwelt.
- Spieler und Bots nutzen nach ihrer Platzierung dieselben Reise-, Mining-, Bau- und
  Kolonisationsregeln.
- Sektoren sind technische und wirtschaftliche Räume, keine Sammlung zufälliger Persönlichkeiten.

Die Welt wächst durch zwei getrennte Vorgänge:

1. **Spieleraufnahme:** Ist ein Ansiedlungssektor voll, wird ein weiterer Ansiedlungssektor für
   neue Spieler geöffnet.
2. **Exploration:** Spieler erschließen unbekannte Nachbarsektoren durch eine reguläre Expedition.

Damit hängt das Wachstum der Frontier nicht davon ab, dass neue Accounts entstehen.

## Konfigurierbarer Startzustand

Eine frische Welt beginnt standardmäßig nicht nur mit Sektor `(0,0)`, sondern mit einem
konfigurierbaren Radius:

```ts
INITIAL_SECTOR_RADIUS: 1, // 0 = 1 Sektor, 1 = 3x3, 2 = 5x5
SECTOR: {
  STATION_CAPACITY: 8,
  BOTS_PER_SETTLEMENT: 2,
},
```

Der Standardradius `1` erzeugt diese neun Sektoren:

```text
(-1,-1)  (0,-1)  (1,-1)
(-1, 0)  (0, 0)  (1, 0)
(-1, 1)  (0, 1)  (1, 1)
```

Bei einer zunächst angenommenen Sektorgröße von ungefähr `16.000 x 16.000` ergibt das eine
zusammenhängende Startwelt von ungefähr `48.000 x 48.000` Welteinheiten. Die endgültige Größe wird
über die daraus resultierenden Flugzeiten geprüft, nicht allein über die Koordinaten.

Die Stationskapazität und Botanzahl sind unabhängig konfigurierbar. Bei den Startwerten belegen
zwei Bots normale Stationsplätze und sechs Plätze bleiben für Spieler. Mit `BOTS_PER_...: 0`
stehen alle Plätze Spielern zur Verfügung. Eine Änderung der Konfiguration entfernt keine bereits
existierenden Bots oder Stationen aus einer persistenten Welt.

## Sektorrollen

Für den ersten Ausbau genügen zwei explizite Rollen. Ein allgemeines Persönlichkeitssystem ist
nicht erforderlich.

### Ansiedlungssektor

Sektor `(0,0)` ist der erste Ansiedlungssektor:

- konfigurierbare Gründungsplätze für Spieler und Bots;
- freie Bereiche um alle noch unbelegten Gründungsplätze;
- eine Startertasche erst bei tatsächlicher Stationsgründung;
- garantierter Zugang zu Carbon, Titanium und Hydrogenium;
- öffentliche Basisasteroiden und gemeinsame Fields.

Wenn später ein weiterer Ansiedlungssektor benötigt wird, wird er an einer noch unbekannten,
angrenzenden Koordinate erzeugt. Seine Spielerplätze werden erst danach vergeben.

### Frontier-Sektor

Die acht übrigen Sektoren des ersten `3x3`-Gebiets sind Frontier-Sektoren:

- keine Gründungsplätze für neue Accounts;
- keine Startertaschen;
- dünnere Hintergrundverteilung;
- größere und stärker spezialisierte Fields;
- später durch eine zusätzliche Station kolonisierbar.

Das Feld `sectors.role` speichert die Werte `settlement` und `frontier`. Weitere Tabellen oder ein
allgemeines Archetypen-Framework sind dafür nicht nötig.

## Wirtschaftliche Geografie

Die Verteilung folgt einer einfachen Distanzregel: Sichere
Basisressourcen liegen näher an Stationen, große und seltene Vorkommen weiter entfernt und stärker
geteilt.

| Zone                | Ziel-Flugzeit mit Mole | Inhalt                                   | Funktion                              |
| ------------------- | ---------------------: | ---------------------------------------- | ------------------------------------- |
| freier Stationsraum |            0-3 Minuten | keine Asteroiden                         | klare Station und sichere Platzierung |
| Startergebiet       |            3-8 Minuten | Carbon, Titanium, Hydrogenium            | verlässlicher Einstieg                |
| lokaler Raum        |           8-20 Minuten | kleine und mittlere Basisasteroiden      | erste wirtschaftliche Auswahl         |
| gemeinsame Fields   |          15-35 Minuten | größere, ressourcenspezifische Vorkommen | Konkurrenz und Expansion              |
| Frontier            |     später 30+ Minuten | seltene und massive Vorkommen            | Exploration und Kolonisation          |

Die Werte werden mit der vorhandenen Reisezeitberechnung in Weltkoordinaten übersetzt. Eine
moderate Verlängerung von Wegen ist Teil der Knappheit. Regelmäßige Basisversorgung mit deutlich
mehr als etwa 90 Minuten Flug pro Strecke soll dagegen durch Expansion und eine weitere Station
abgelöst werden.

## Einfacher Generator statt Sektor-Persönlichkeiten

Der erste Standardgenerator besteht aus vier verständlichen Schritten:

1. Stationsbereiche beziehungsweise freie Reservierungszonen festlegen.
2. Wenige gemeinsame ressourcenspezifische Fields erzeugen.
3. Kleine und mittlere Basisasteroiden dünn im übrigen Raum verteilen.
4. Die Startertasche eines Slots erst erzeugen, wenn dort eine Station gegründet wird.

`SECTOR_PERSONALITIES`, zufällige Hintergrunddichten und die Vielzahl rein visueller Feldformen
entfallen. Für den Anfang genügen ein lockeres `cloud`-Field und ein längliches `belt`-Field.
Fields bleiben reine Generierungsgruppen und erhalten keine eigene Datenbanktabelle, solange sie
keine persistente Spielmechanik besitzen.

Der bestehende deterministische Seed, Chunk-Koordinaten und die räumliche Kollisionsprüfung werden
weiterverwendet.

## Aufräumgrundsatz für die Weltgenerierung

Die neue Generierung ersetzt den früheren Testgenerator. Sie wird nicht als zweite Variante
danebengestellt. Da keine produktive Welt und keine zu erhaltenden Spielstände existieren, sind
weder Kompatibilitätsschichten noch Backfills für alte Welt-Daten erforderlich. Eine geänderte
Generatorversion erhöht den World-Seed und die Entwicklungsdatenbank wird neu erzeugt.

Beim Umbau gelten folgende Regeln:

- `world-config.ts` enthält danach nur Werte, die von der aktiven Generierung oder einem bereits
  spielbaren System gelesen werden.
- `sector-gen.ts` orchestriert nur Sektorgrenzen, Slots, Fields und Hintergrundverteilung. Alte
  Persönlichkeiten, alternative Dichtepfade und Legacy-Fallbacks werden gelöscht.
- `shapes.ts` behält nur die tatsächlich verwendeten Formen. Ein generisches Registry-System wird
  nicht für hypothetische Formen erhalten.
- `asteroid-gen.ts`, Generierungstypen und Kommentare bilden ausschließlich das neue
  Vorrats- und Adernmodell ab.
- `seed.ts`, Stations-, Bot- und Asteroiden-Services werden im selben Schritt auf den neuen Ablauf
  umgestellt. Kein Service darf zwischen altem und neuem Generator umschalten.
- Nicht mehr referenzierte Konstanten, Hilfsfunktionen, Typen, Tests und Kommentare werden direkt
  entfernt statt als `deprecated`, `legacy` oder auskommentierter Code liegen zu bleiben.
- Datenbankfelder bleiben nur erhalten, wenn ein aktiver oder in der unmittelbar folgenden Phase
  umgesetzter Ablauf sie benötigt. Zukünftige Mechaniken dürfen ihre passenden Felder später neu
  einführen.

Ziel ist nicht eine neue Abstraktionsschicht, sondern der kleinste nachvollziehbare Generator für
die vereinbarte Welt.

### Zielzustand der betroffenen Dateien

| Bereich              | Behält ausschließlich                                                                          | Wird entfernt                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `world-config.ts`    | Weltmaße, Chunkgröße, Seed, Sektor- und Slotkapazitäten, aktive Abstands- und Verteilungswerte | ungenutzte Varianten, abgeleitete Doppelwerte, alte Balancewerte und Zukunftskonfiguration    |
| `sector-gen.ts`      | deterministische Erzeugung eines Ansiedlungs- oder Frontier-Sektors sowie einer Startertasche  | alternative Generatorpfade, Persönlichkeiten, implizite Defaults und persistenzbezogene Logik |
| `asteroid-gen.ts`    | Erzeugung endlicher Asteroiden und Adern aus vollständig übergebenen Parametern                | alte Yield-, Stabilitäts-, Reinheits- und Respawn-Annahmen                                    |
| `shapes.ts`          | nur die tatsächlich verwendeten einfachen Punktverteilungen                                    | Registry, ungenutzte Formen und vorsorgliche Erweiterungspunkte                               |
| `sector.service.ts`  | Sektor idempotent persistieren und den nächsten Ansiedlungssektor öffnen                       | fachliche Generierungsentscheidungen und Legacy-Fallbacks                                     |
| `station.service.ts` | Slot beanspruchen, Station initialisieren und Startertasche transaktional anlegen              | globale Slotannahmen und direkte Generator-Sonderwege                                         |
| Bot-Services         | Bots für einen konkreten bewohnten Ansiedlungssektor bereitstellen und normale Aktionen wählen | globale Bot-Farm, eigene Ressourcenregeln und weltweite ungefilterte Zielsuche                |
| Seed                 | eine frische konfigurierte Welt sowie Entwicklungsnutzer über reguläre Services anlegen        | zweite Implementierung von Welt-, Stations- oder Botregeln                                    |

Jede Datei soll eine erkennbare Aufgabe besitzen. Eine gemeinsame Hilfsfunktion wird erst
extrahiert, wenn mindestens zwei aktive Aufrufer dieselbe Regel benötigen. Alte Exporte werden
nicht aus Rücksicht auf nicht mehr vorhandene Aufrufer behalten.

Der Aufräumschnitt ist erst abgeschlossen, wenn Typecheck und Tests bestehen und Quellcodesuchen
keine alten Generatorbegriffe oder unreferenzierten Exporte mehr finden. Weil nur
Entwicklungsdaten existieren, darf die Datenbank dabei neu erzeugt werden; unnötige
Kompatibilitätsmigrationen sind kein Abnahmekriterium.

## Startertaschen und neue Spieler

Starterasteroiden werden nicht mehr für alle freien Plätze beim Weltstart erzeugt. Dadurch können
Bots oder bestehende Spieler die Ressourcen eines zukünftigen Spielers nicht vorher abbauen.

Bei der Stationsgründung passiert transaktional:

1. Einen freien Spielerplatz im aktuellen Ansiedlungssektor sperren.
2. Die Station anlegen und den Platz belegen.
3. Stationsressourcen, Gebäude und Startschiffe wie bisher erzeugen.
4. Die deterministische Startertasche dieses Platzes erzeugen.

Die Tasche enthält als aktuellen, durch Regressionstests abgesicherten Startvertrag:

- zwei Carbon-Asteroiden;
- zwei Titanium-Asteroiden;
- einen kleineren Hydrogenium-Asteroiden.

Nach der Erzeugung sind dies normale öffentliche Asteroiden. Sie besitzen keinen Eigentümer und
keine abweichenden Mining-Regeln.

Die Spawnplätze benötigen lokal die Typen `player` und `bot`. Ihre Anzahl wird aus der
Konfiguration erzeugt. `slotIndex` wird pro Sektor statt global eindeutig, damit weitere Sektoren
dieselben lokalen Indizes verwenden können.

## Aufnahme weiterer Spieler

Ein neuer Spieler wird nicht beliebig in den ältesten freien Platz der gesamten Welt gesetzt.

```text
aktuellen Ansiedlungssektor suchen
  -> freier player-Slot vorhanden: belegen
  -> kein Slot vorhanden: nächsten Ansiedlungssektor erzeugen und dort belegen
```

Die erste Version schließt einen Ansiedlungssektor allein über seine konfigurierte Kapazität. Die
frisch erzeugte Startertasche garantiert weiterhin einen funktionierenden Einstieg. Eine spätere
Prüfung des öffentlichen Restvorrats kommt nur hinzu, wenn reale Spielverläufe zeigen, dass neue
Spieler trotz Startertasche in einem alten Sektor festlaufen.

Gleichzeitige Stationsgründungen dürfen weder denselben Slot noch denselben neuen Sektor doppelt
beanspruchen.

## Sektorgebundene Bots

Die frühere globale Erzeugung einer festen Botanzahl wurde durch eine sektorgebundene Regel
ersetzt:

- Ein Ansiedlungssektor besitzt höchstens die konfigurierte Botanzahl.
- Bots werden frühestens erzeugt, wenn der erste Spieler den Sektor bezieht.
- Sie belegen ausschließlich `bot`-Slots und erhalten dieselbe Startertasche wie Spieler.
- Nach ihrer Erzeugung sind Benutzer, Station, Ressourcen, Schiffe und Aufträge normal persistent.
- Bots entstehen nicht pro neuem Spieler und werden nicht automatisch ersetzt, wenn sie später
  verschwinden.

Die Platzierungsregel darf sich unterscheiden; alle anschließenden Spielregeln bleiben gemeinsam.

## Sektorerschöpfung und Exploration

Ein erschöpfter Sektor bleibt bestehen. Stationen, Reisen und Geschichte werden nicht gelöscht.
Eine alte Station kann sich später vom Mining-Ausgangspunkt zum Produktions-, Lager-, Handels-
oder Verteidigungsstandort entwickeln.

Neue Frontier entsteht durch eine Spieleraktion:

1. An der Grenze der bekannten Welt wird ein unbekannter angrenzender Sektor angeboten.
2. Der Spieler startet eine Expedition zu seiner Koordinate.
3. Eine normale, persistierte Reise wird angelegt.
4. Bei Ankunft wird der Sektor genau einmal deterministisch erzeugt und gespeichert.
5. Der Sektor wird für die gemeinsame Welt als entdeckt markiert.
6. Das eingesetzte Schiff fliegt mit derselben Reiseberechnung zur Ursprungsstation zurück und
   wird erst dort wieder verfügbar.

Die Kamera erzeugt keine Sektoren. Zwei gleichzeitig eintreffende Expeditionen dürfen wegen der
bereits vorhandenen Eindeutigkeit von `(sectorX, sectorY)` nur einen Sektor anlegen.

Eine erste Expedition benötigt keine seltene Ressource. Ein Spieler mit erschöpfter Umgebung muss
durch Zeit und ein vorhandenes Schiff weiterhin einen Ausweg besitzen. Bots erhalten diese Aktion
erst, nachdem sie für Spieler funktioniert, und durchlaufen danach dieselben Kosten und Zeiten.

## Zweite Station und Kolonisation

Stationen werden nicht verschoben. Nach der Exploration kann der Spieler stattdessen eine weitere
Station in einem geeigneten Frontier-Sektor gründen.

Die erste Kolonisationsversion benötigt:

- eine reguläre Spieleraktion mit Eigentums- und Kapazitätsprüfung;
- eine persistierte Reise beziehungsweise Bauzeit;
- einen gültigen Standort mit Mindestabstand;
- normale Kosten aus Basisressourcen;
- einen verfügbaren Miner, der bei erfolgreicher Gründung aus der Ursprungsflotte in die neue
  Station übertragen wird;
- dieselbe technische Stationsinitialisierung wie bei der ersten Station, aber keine kostenlose
  Startertasche, Ressourcen oder zusätzlichen Schiffe.

Ein Frontier-Sektor wird durch eine Kolonie nicht automatisch zum Aufnahme-Sektor für neue
Accounts. Diese beiden Rollen bleiben getrennt.

## Seltene Ressourcen nach Sektorkoordinate

Solange Exploration und Kolonisation fehlen, bleibt die Ressourcenverteilung der anfänglichen
`3x3`-Welt so vollständig, dass alle vorhandenen Mechaniken getestet werden können. Erst nachdem
Nachbarsektoren erreichbar und neue Stationen möglich sind, wird die Trennung konsequent.

Dann gilt:

```text
abs(sectorX + sectorY) gerade   -> Kyber-Schwerpunkt
abs(sectorX + sectorY) ungerade -> Astatine-Schwerpunkt
```

Ein Schwerpunkt bedeutet:

- ein passendes seltenes Field wird garantiert;
- die jeweils andere seltene Ressource wird dort nicht regulär erzeugt;
- Sekundär- und Spuradern umgehen diese Einschränkung nicht;
- Carbon, Titanium und Hydrogenium bleiben die Grundversorgung von Ansiedlungssektoren.

Orthogonal benachbarte Sektoren besitzen dadurch automatisch die jeweils andere Spezialisierung.
Ein Persönlichkeitssystem oder zufällige Sektorbiome sind dafür nicht notwendig.

## Vorrat, Asteroidenzahl und Konkurrenz

Die Zahl der Asteroiden wird nicht isoliert festgelegt. Entscheidend ist der Vorrat im Verhältnis
zur möglichen Förderung:

```text
Sektorvorrat = aktive Stationen
              x typische Minerzahl je Station
              x effektive Lieferleistung
              x gewünschte Lebensdauer
```

Erste Größenordnung für einen voll belegten Ansiedlungssektor:

| Quelle                                  | Anzahl Asteroiden |
| --------------------------------------- | ----------------: |
| fünf Starterasteroiden je belegtem Slot |         bis zu 40 |
| dünner Hintergrund                      |             20-30 |
| ein gemeinsames Basis-Field             |              8-12 |
| ein seltenes Spezial-Field              |              8-12 |
| Gesamt bei voller Belegung              |    ungefähr 75-95 |

Ein Frontier-Sektor besitzt ohne Startertaschen mit der aktuellen Konfiguration ungefähr 45-55
Asteroiden. Für die anfängliche `3x3`-Welt ergibt das grob 400-500 Asteroiden zuzüglich später erzeugter
Startertaschen. Diese Zahlen sind Testbereiche, keine endgültige Balance.

Die aktuelle Standardwelt wird zusätzlich über eine ausführbare Wirtschaftsbaseline abgesichert:
Starterflüge dauern ungefähr 3-7 Minuten pro Strecke, der erste volle Mole-Rundlauf ungefähr eine
Stunde und ein Starterasteroid hält selbst mit drei Mole mindestens einen vollen Tag. Bei voller
Sektorbelegung und drei Mole je Station liegt der gemeinsame Referenzvorrat ungefähr zwischen 30
und 60 Tagen. Diese Grenzen verhindern versehentliche kurzfristige Erschöpfung, ohne unendliche
Vorkommen einzuführen.

Konkurrenz entsteht durch wenige gemeinsame Fields, endliche Vorräte, Flugzeiten und die
tatsächliche Ankunftsreihenfolge. Die frühere Begrenzung über `MINING_SLOTS` ist entfernt: Ein
Asteroid besitzt keine zusätzliche Förder- oder Teilnehmerkapazität. Mehrere Spieler und Bots
dürfen gleichzeitig Miner senden; die transaktionale Beanspruchung bei Ankunft entscheidet über
den letzten Vorrat.

## Asteroiden-Nachschub

Automatischer Nachschub ist nicht Teil der geplanten Umsetzung. Er wird erst bewertet, nachdem
Exploration und zweite Station spielbar sind.

Falls alte Stationen danach nachweislich unbrauchbar werden, ist die kleinste Rückfalloption:

- gelegentlich neue kleine, öffentliche Asteroiden mit Basisressourcen;
- jeder neue Asteroid besitzt wieder einen endlichen Vorrat;
- seltene Ressourcen und große Fields werden nicht regeneriert;
- bestehende Mining-Aufträge springen nicht automatisch auf neue Ziele.

Ein periodisches Respawn-System, persönliche Ressourcenvorkommen oder dauerhaft unendliche
Asteroiden werden nicht vorsorglich gebaut.

## Technische Umsetzung in Reihenfolge

### 1. Generatorvertrag absichern

- Alle Aufrufer und Datenpfade des früheren Generators erfassen und den zu ersetzenden Code
  markieren.
- Pure Tests für deterministische Ausgabe, Sektorgrenzen und Mindestabstände ergänzen.
- Prüfen, dass Adern zusammen exakt den Gesamtvorrat ergeben und niemals negativ starten.
- Kennzahlen pro Sektor für Asteroidenzahl, Ressourcenmenge und nächste Vorkommen ausgeben.

Abgeschlossen, wenn derselbe Seed reproduzierbar dieselbe gültige Welt erzeugt.

### 2. Konfigurierbare Startwelt erzeugen

- `INITIAL_SECTOR_RADIUS`, Stationskapazität und Botanzahl in `WORLD_CONFIG` aufnehmen.
- Standardmäßig die neun Sektoren von `-1..1` erzeugen und gemeinsam persistieren.
- `(0,0)` als `settlement`, die übrigen Sektoren als `frontier` kennzeichnen.
- Den World-Seed erhöhen und die Entwicklungswelt neu erzeugen; alte Entwicklungsasteroiden werden
  nicht künstlich umgerechnet und erhalten keinen Kompatibilitätspfad.

Abgeschlossen, wenn eine frische Datenbank genau einen zusammenhängenden `3x3`-Startbereich
enthält.

### 3. Verteilung vereinfachen

- `WORLD_CONFIG` auf die tatsächlich benötigten Topologie-, Distanz-, Ressourcen- und
  Vorratswerte reduzieren.
- `SECTOR_PERSONALITIES`, ihre Dichteformel, ungenutzte Formen und alle dazugehörigen Helfer,
  Typen und Fallbacks entfernen.
- Einen festen Standardablauf aus Fields und dünnem Hintergrund verwenden.
- Ressourcengewichte und Größen nach Ansiedlungs- beziehungsweise Frontier-Rolle trennen.
- Flugzeiten von typischen Stationspositionen als Abnahmekriterium verwenden.
- Seed-, Stations-, Bot- und Asteroiden-Services direkt umstellen und den alten Pfad vollständig
  löschen.

Abgeschlossen, wenn die Karte freie Räume, lokale Basisziele und wenige erkennbare gemeinsame
Fields zeigt und eine Quellcodesuche keine Konstanten, Typen oder Aufrufe des alten Generators mehr
findet.

### 4. Startertaschen an Stationsgründung koppeln

- Startertaschen aus dem anfänglichen Sektorgenerator entfernen.
- Freie Bereiche um unbesetzte Slots weiterhin reservieren.
- Die Tasche transaktional und deterministisch mit der Stationsgründung erzeugen.
- Wiederholung und parallele Stationsgründung gegen doppelte Asteroiden absichern.

Abgeschlossen, wenn kein zukünftiger Spielerbestand vor seiner Stationsgründung abgebaut werden
kann.

### 5. Kapazitäten und Mining-Konkurrenz korrigieren

- Spieler- und Bot-Slots aus der Konfiguration erzeugen.
- `slotIndex` pro Sektor eindeutig machen.
- Spieler- und Bot-Platzierung auf den vorgesehenen Slottyp begrenzen.
- `MINING_SLOTS` aus API, Bot-Auswahl, Vorschau und UI entfernen.

Abgeschlossen, wenn die konfigurierte Kapazität transaktional gilt und beliebig viele Akteure um
den endlichen Vorrat eines Asteroiden konkurrieren können.

### 6. Bots sektorgebunden erzeugen

- Globale Bot-Erzeugung durch die konfigurierte Zielzahl je Ansiedlungssektor ersetzen.
- Bots erst mit dem ersten menschlichen Bewohner des Sektors aktivieren.
- Bestehende gemeinsame Stations- und Aktionsservices weiterverwenden.

Abgeschlossen, wenn eine frische Welt exakt die konfigurierte Botzahl erhält und neue Spieler
keine zusätzlichen Bots pro Account erzeugen.

### 7. Neue Aufnahme-Sektoren öffnen

- Einen aktuellen Ansiedlungssektor für Spielergründungen bestimmen.
- Bei voller Spieler-Kapazität den nächsten zusammenhängenden Ansiedlungssektor erzeugen.
- Gleichzeitige Registrierungen gegen doppelte Sektoren und Slots absichern.

Abgeschlossen, wenn der erste Spieler oberhalb der Kapazität automatisch in einem neuen,
persistenten Ansiedlungssektor starten kann.

### 8. Exploration und dynamische Frontier umsetzen

- Unbekannte angrenzende Sektoren als mögliche Expeditionsziele darstellen.
- Expedition als reguläre persistierte Aktion mit Flugzeit implementieren.
- Den Zielsektor erst bei erfolgreicher Ankunft idempotent erzeugen und gemeinsam entdecken.
- Spieleraktionen zuerst fertigstellen; Bots dürfen sie anschließend über denselben Service wählen.

Abgeschlossen, wenn dieselbe Spielergruppe ohne neue Accounts die bekannte Welt kontrolliert
erweitern kann.

### 9. Zweite Station und Kolonisation ermöglichen

- Eine reguläre Kolonisationsaktion für einen entdeckten Frontier-Sektor implementieren.
- Standort, Mindestabstand, Kosten, Reise beziehungsweise Bauzeit und Eigentum prüfen.
- Die neue Station mit denselben persistierten Stationstabellen initialisieren.

Abgeschlossen, wenn eine alte unbewegliche Station durch eine neue frontiernahe Station ergänzt
werden kann.

### 10. Seltene Ressourcen konsequent spezialisieren

- Kyber- und Astatine-Schwerpunkte anhand der Koordinatenparität aktivieren.
- Die jeweils andere seltene Ressource aus Primär-, Sekundär- und Spuradern ausschließen.
- Tests für benachbarte Gegenspezialisierung und erreichbare Progression ergänzen.

Abgeschlossen, wenn kein einzelner Sektor alle seltenen Ressourcen liefert und ein erreichbarer
Nachbar die jeweils andere Spezialisierung besitzt.

### 11. Erschöpfung beobachten, nicht vorsorglich kaschieren

- Sektorvorrat, aktive Miner, typische Lieferleistung und Flugzeiten aus Spielständen auswerten.
- Vorräte und Verteilung im späteren Balancing anpassen.
- Asteroiden-Nachschub nur implementieren, wenn Exploration, Kolonisation und Handel alte
  Stationen nicht ausreichend tragen.

Abgeschlossen ist zunächst die Entscheidung, bewusst keinen Nachschub zu bauen. Ein späterer
Nachschub benötigt einen beobachteten spielerischen Grund und einen eigenen Plan.

## Verbindliche Prüfungen

- Derselbe Seed und dieselben Koordinaten erzeugen denselben Sektor.
- Es existiert nur ein aktiver Sektorgenerator und kein Legacy- oder Feature-Flag-Pfad.
- Eine frische Standardwelt enthält genau die konfigurierte zusammenhängende Sektormenge.
- Nur Ansiedlungssektoren besitzen Gründungsplätze.
- Jeder neue Spieler erhält genau eine Startertasche mit allen drei Basisressourcen.
- Spieler- und Botkapazität lassen sich unabhängig konfigurieren.
- Eine Expedition kann nur einen angrenzenden unbekannten Sektor erzeugen.
- Gleichzeitige Expeditionen erzeugen denselben Sektor höchstens einmal.
- Expeditionen binden ihr Schiff bis zum abgeschlossenen Rückflug.
- Spieler und Bots zahlen bei Nutzung der gemeinsamen Services für Expedition und Kolonisation
  dieselben Kosten und warten dieselbe Zeit; Bots erhalten dafür keinen Sonderpfad.
- Eine Kolonie erhält genau den eingesetzten Miner, aber keine kostenlose Starterausstattung.
- Ein erschöpfter Asteroid und ein erschöpfter Sektor werden nicht automatisch regeneriert.
- Orthogonale Nachbarsektoren besitzen nach Aktivierung unterschiedliche seltene Schwerpunkte.
