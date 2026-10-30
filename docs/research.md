# Forschung

Forschung gilt für den ganzen Account und hat Stufen. Sie kostet Hydrogenium, ab Tier 3 auch Kyber
und ab Tier 5 Astatine. Schiffe und Verteidigung werden nicht erforscht. Sie werden frei, sobald die
nötigen Forschungs- und Gebäudestufen erreicht sind. Alle Formeln stehen pur in
`@orions-frontier/game-config` (`research.ts`, `research-effects.ts`). API, Bots, Playtest und
Frontend verwenden dieselben Funktionen.

## Ablauf

- Es läuft eine Forschung gleichzeitig. Research Network gibt einen zweiten Slot.
- Beim Start wählt der Spieler die zahlende Station. Die Kosten gehen dort sofort ab.
- Laufende Forschung lässt sich abbrechen, solange sie noch nicht fällig ist. Die Kosten gehen voll
  an die zahlende Station zurück, begrenzt durch ihren Lagerplatz.
- Der Abschluss läuft über die gemeinsame Fälligkeitsabfrage. Er erhöht die Stufe genau einmal und
  sendet `research_completed` an den Account (Logbuch und WebSocket).
- Forschung bleibt bei Stationsverlust und Neustart erhalten.

Gespeichert wird in `user_research`: eine Zeile pro Account und Technologie, mit `level`, laufendem
`started_at`/`completes_at` und `paid_by_station_id`.

## Tiers, Kosten und Dauer

| Tier | Gate                         | Kosten Stufe 1            | Dauer Stufe 1 |
| ---- | ---------------------------- | ------------------------- | ------------- |
| 1    | Laboratory 1                 | 150 H                     | 10 min        |
| 2    | Laboratory 3                 | 400 H                     | 30 min        |
| 3    | Laboratory 5, Spectral       | 900 H, 150 Kyber          | 1,5 h         |
| 4    | Laboratory 8                 | 2.000 H, 400 Kyber        | 4 h           |
| 5    | Laboratory 11, Deep Spectral | 4.500 H, 1.000 K, 200 Ast | 10 h          |

- Jede weitere Stufe kostet und dauert das 1,5-Fache der vorigen. Kosten werden auf 10 gerundet.
- Das Laboratory deckelt jede Forschungsstufe auf seine eigene Stufe. Jede Stufe über 1 verkürzt
  die Forschung um 2 %.
- Lab-Gate, Lab-Deckel, Lab-Zeitbonus und Gebäudevoraussetzungen von Forschungen nutzen die höchste
  Stufe über alle Stationen. Unlocks von Schiffen und Verteidigung nutzen die bauende Station.
- `researchBlockers` liefert die Gründe, warum eine Stufe nicht startbar ist: Tier-Gate,
  Voraussetzung, Gebäude, Lab-Deckel, Maximalstufe. Die UI zeigt sie als Chips an.

## Baum

| Ast                    | T1                                 | T2                                 | T3                                   | T4                     | T5                      |
| ---------------------- | ---------------------------------- | ---------------------------------- | ------------------------------------ | ---------------------- | ----------------------- |
| Extraction             | Extraction Algorithms, Cargo Comp. |                                    | Autonomous Rerouting                 | Deep Core Drilling     | Autonomous Mining Fleet |
| Navigation and Sensors | Ion Propulsion, Sensor Arrays      | Spectral Analysis, Long-Range Surv | Signature Analysis, Colony Logistics | Deep Spectral Analysis | Frontier Charter        |
| Engineering            | Construction Robotics              | Fabrication Lines                  | Parallel Construction                | Research Network       | Nanite Assembly         |
| Military               | Weapons, Armor                     | Shields                            |                                      |                        | Fleet Coordination      |

Die genauen Voraussetzungen und Maximalstufen stehen in `researchDefinitions`.

## Wirkungen

| Forschung              | Wirkung pro Stufe                                                  |
| ---------------------- | ------------------------------------------------------------------ |
| Extraction Algorithms  | +5 % Abbaurate                                                     |
| Cargo Compression      | +5 % Laderaum (Mining, Salvage, Beute)                             |
| Deep Core Drilling     | +6 % Lieferung, der Asteroid verliert nur die abgebaute Menge      |
| Ion Propulsion         | Flugdauer ÷ (1 + 0,05 × Stufe)                                     |
| Sensor Arrays          | +5 % Scannerreichweite                                             |
| Weapons                | +5 % Angriff eigener Schiffe, nicht der Stationsverteidigung       |
| Armor                  | +5 % Verteidigung eigener Schiffe                                  |
| Shields                | +5 % Verteidigung der Station                                      |
| Fleet Coordination     | +5 % Crew-Slots                                                    |
| Construction Robotics  | −3 % Bauzeit von Gebäuden und Verteidigung, addiert zum Core-Bonus |
| Fabrication Lines      | −3 % Schiffsbauzeit, addiert zum Shipyard-Bonus                    |
| Nanite Assembly        | −4 % Gebäudekosten                                                 |
| Parallel Construction  | +1 Bau-Slot (Basis 1)                                              |
| Research Network       | +1 Forschungs-Slot                                                 |
| Colony Logistics       | +1 Station                                                         |
| Frontier Charter       | +1 Station und +1 gleichzeitige Expedition                         |
| Long-Range Survey      | Expeditionen möglich                                               |
| Spectral Analysis      | Kyber-Adern sichtbar und abbaubar                                  |
| Deep Spectral Analysis | Astatine-Adern sichtbar und abbaubar                               |
| Signature Analysis     | Signatur anrückender Flotten sichtbar                              |
| Autonomous Rerouting   | Miner fliegen bei leerem Asteroiden den nächsten passenden an      |
| Autonomous Mining Fl.  | Neue und freie Miner werden automatisch zugewiesen                 |

Bau- und Schiffsbauzeit sind auf höchstens 75 % Verkürzung begrenzt. `researchModifiers(levels)`
fasst alles zusammen; der Server liest die Stufen bei jeder Regelanwendung frisch aus der Datenbank.

## Sichtbarkeit von Kyber und Astatine

- Gefiltert wird pro Ader und serverseitig. Ein Asteroid ohne sichtbare Ader fehlt ganz, auch als
  unscannter Punkt. Die angezeigte Hauptressource ist die erste sichtbare Ader.
- Miner bauen nur sichtbare Adern ab. Ein Auftrag endet, wenn die sichtbaren Adern leer sind. Der
  Asteroid wird erst gelöscht, wenn alle Adern leer sind.
- Lager, Beute und Trümmerfelder werden nicht gefiltert.

## Slots und Limits

- **Bau-Slots:** Gebäude und Verteidigung einer Station teilen sich die Slots. Laufende Upgrades
  lassen sich vor Fälligkeit mit voller Rückerstattung abbrechen.
- **Werft:** eine Bauschlange pro Station. Produktions-Slots (1, 2 ab Shipyard 5, 3 ab Shipyard 10)
  bauen parallel: Dauer = ⌈Menge / Slots⌉ × Bauzeit × Bonus. Jeder Auftrag lässt sich einzeln
  abbrechen; spätere Aufträge rücken um die frei gewordene Zeit vor.

## Warteschlangen

- Gebäude und Verteidigung haben eine Queue pro Station, Forschung eine pro Account. Höchstens
  10 wartende Einträge je Queue, ebenso 10 Werftaufträge.
- Bezahlt wird beim Einreihen. Bezahlte Rohstoffe sind vor Beute sicher. Die Erstattung entspricht
  genau dem gezahlten Betrag, begrenzt durch freien Lagerplatz.
- Dieselbe Stufe kann mehrfach hintereinander eingereiht werden (Core 3 → 4 → 5). Eingereihte
  Stufen zählen als erfüllte Voraussetzung nur innerhalb derselben Queue.
- Ein Eintrag startet, sobald ein Slot frei wird, auch offline zum Zeitpunkt des Freiwerdens. Die
  Bauzeit wird beim Start berechnet.
- Entfernen oder Abbrechen prüft die Kette neu: Einträge, die auf der entfernten Stufe aufbauten
  (Core 4 entfernt → Core 5 und 6), fallen mit voller Erstattung mit heraus.
- Kann ein Eintrag beim Start nicht beginnen, fällt er mit Erstattung heraus und das Logbuch nennt
  ihn. Keine Umsortierung. Bots nutzen keine Queue.
- **Stationen:** Limit = 1 + Colony Logistics + Frontier Charter. Kolonisierungen im Flug zählen mit.
- **Expeditionen:** brauchen Long-Range Survey, gleichzeitig 1 + Frontier Charter pro Account.

## Bots

Bots nutzen denselben Dienst und dieselben Blocker. Der Research-Goal bevorzugt Forschungen, die ein
gewünschtes Schiff (Titan, Collector, erster Jäger) oder die nächste Expansion freischalten, und
baut das Laboratory oder ein anderes Gebäude aus, wenn nur eine Gebäudestufe fehlt.
