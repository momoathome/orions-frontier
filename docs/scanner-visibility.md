# Scanner, Radar und räumliche Sichtbarkeit

Sichtbarkeit wird ausschließlich räumlich bestimmt. Jede Station erzeugt mit ihrem eigenen
Scannerlevel einen Erfassungskreis in Weltkoordinaten. Der Spieler sieht die Vereinigung der Kreise
aller eigenen Stationen. Sektoren sind keine Sichtbarkeits- oder Berechtigungsgrenze.

## Regeln

Für einen Punkt `p` und die eigenen Stationen `s` gilt:

```text
gescannt(p) = eigenes Objekt
              oder es existiert eine eigene Station s mit
              (p.x - s.x)² + (p.y - s.y)² <= scannerRange(s)²
```

- Die Prüfung erfolgt serverseitig in Welt-Units. Ein Objekt auf der Kreisgrenze gilt als gescannt.
- Jede Station verwendet nur ihr eigenes Scannerlevel. Überlappende Kreise verstärken sich nicht.
- Eigene Stationen, Schiffe und Missionen bleiben unabhängig von der Abdeckung sichtbar.
- Berechtigungsprüfungen verwenden dieselbe Regel wie Kartenabfragen. Eine bekannte UUID umgeht den
  Scanner nicht. Außerhalb der Abdeckung antworten Detail- und Aktionsendpunkte mit `NOT_FOUND`.
- Die Prüfung läuft unmittelbar vor dem Anlegen eines Auftrags erneut. Eine ältere Kartenantwort ist
  keine Berechtigung.
- Ein Auftrag darf jedes Ziel verwenden, das irgendeine eigene Station erfasst. Das Wissen wird im
  eigenen Stationsnetz geteilt, Entfernung und Reisezeit bleiben die Kosten.

Die Scannerreichweite liegt ausschließlich in `@orions-frontier/game-config` (`scanner_range`:
Level 0 = 0, Level 1 = 1.000, je Level +500, Level 15 = 8.000, mal Sensor Arrays). API, Bots und
UI verwenden denselben berechneten Wert. `GET /stations` liefert ihn als `scannerRange`; das Frontend rechnet ihn nicht
selbst aus.

## Sichtbarkeit nach Objekttyp

| Objekt                  | Außerhalb der Abdeckung                     | Innerhalb der Abdeckung                        |
| ----------------------- | ------------------------------------------- | ---------------------------------------------- |
| Asteroid                | Position (`scanned: false`, Details `null`) | Größe, Adern und Restmengen                    |
| Fremde Station          | Name, Position, Besitzerart, neutrales Bild | grobes `visualProfile` (Tiers 0–3)             |
| Trümmerfeld             | unsichtbar                                  | Position und verwertbare Ressourcen            |
| Kampfflotte, Mission    | unsichtbar                                  | Radarkontakt: Position, Vektor, grobe Signatur |
| Fremder ziviler Verkehr | schwacher Punkt ohne Signatur               | Radarkontakt                                   |
| Eigene Station, Reise   | vollständig                                 | vollständig                                    |

- Miner dürfen unscannte Asteroiden blind anfliegen. Zusammensetzung und Reserve werden für den
  Spieler sichtbar, sobald eine eigene Zuweisung dort ihre erste Ladung auf den Rückweg schickt.
- Angriffe dürfen jede Station auf der Karte treffen, auch außerhalb der Abdeckung. Die
  Kampfprognose nutzt in der Abdeckung den Scanner. Außerhalb schätzt sie nur die Siegchance aus
  dem eigenen letzten Kampfbericht, also dem, was Überlebende beim Ziel gesehen haben; ohne
  Bericht fliegt die Flotte blind.
- Trümmerfelder, fremde Bewegungen und Bergung bleiben an die Abdeckung gebunden.
- Fremde Stationsintegrität ist nur in der Abdeckung sichtbar und dann grob in vier Stufen.
- Ausnahme: Ein Angriff auf eine eigene Station ist sofort als eingehender Angriff mit Ankunftszeit
  sichtbar, ohne Zusammensetzung der Flotte.
- `visualProfile` enthält keine exakten Gebäudelevel, Flottenzahlen, Fracht- oder Auftragsdaten.
- Ein Radarkontakt enthält keine Start- und Zielkoordinaten, keine Fracht, keine Assignment-ID,
  keinen Missionsbesitzer und keine exakte Gruppengröße. Der Client interpoliert kurz zwischen den
  Fünf-Sekunden-Aktualisierungen.
- Verliert ein Spieler eine Station, laufen eigene Aufträge weiter; die Abdeckung schrumpft sofort.
- Kyber- und Astatine-Adern sind zusätzlich an Forschung gebunden (Spectral bzw. Deep Spectral
  Analysis). Gefiltert wird pro Ader in SQL; ein Asteroid ohne sichtbare Ader fehlt ganz. Details in
  `docs/research.md`.

## Umsetzung

`services/map/scanner-visibility.ts` enthält nur die gemeinsame Regel:
`getUserScannerCoverages`, `getResearchModifiers`, `isPointVisible` (quadrierte Distanz ohne
Wurzel), `visibleChunkBounds` und `scannerChunkBounds`. Objektservices laden ihre Daten selbst; es gibt
keine zweite Distanzformel in SQL, Bots oder Frontend.

- **Statische Objekte:** PostgreSQL grenzt über Chunkindizes auf Kameraausschnitt ∩
  Scanner-Bounding-Boxes ein, der API-Prozess prüft danach den exakten Kreis. Ohne Schnittmenge
  entfällt die Abfrage.
- **Detailzugriffe:** Laden per Primärschlüssel, danach Punktprüfung.
- **Reisen:** Start- und Zielkoordinaten werden beim Anlegen gespeichert. Die aktuelle Position wird
  pro Antwort aus der Zeit interpoliert; aktive Reisen liest ein partieller Index auf
  `status = 'traveling'`. Positionen werden nicht laufend in die Datenbank geschrieben.
- **Frontier:** Sektoren sind öffentliche Weltmetadaten. Unbekannte Randkoordinaten bestimmt SQL
  über die vier Nachbarn jedes Sektors (`NOT EXISTS`, nächste 32 Ziele). Expedition und
  Kolonisation hängen nicht von der Objektsichtbarkeit ab.

Eine materialisierte aktuelle Reiseposition, eine `VALUES`-CTE für viele Stationen, GiST oder PostGIS
kommen erst, wenn Messungen es verlangen: mehr als 10.000 aktive Reisen, `GET /world/trips` über
100 ms p95 oder ein dominanter Reisescan in `EXPLAIN ANALYZE`.

## Bewusst vertagt

- Tarnung, Sensorsignaturen und unterschiedliche Erkennungsqualität;
- gemeinsame Radarfreigabe zwischen verbündeten Spielern;
- historische Kontakte oder ein persistentes Radarlog;
- Radarstörungen, Nebel und sektorabhängige Modifikatoren.
