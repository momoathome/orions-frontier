# Bot-System

Stand: Schritt 1 (Glaubwürdige Bewohner) vollständig – `goal_v1` aktiv.

Bots beleben dieselbe persistente Welt wie Spieler. Sie besitzen normale Benutzer, Stationen,
Ressourcen, Gebäude, Schiffe und Reisen. Nur der kleine Controller, der die nächste Aktion wählt,
ist bot-spezifisch.

```text
Spieler -> HTTP-Route -----+
                          +-> Domain-Service -> PostgreSQL -> Simulation
Bot -> Entscheidung -------+
```

## Systemvertrag

- Der Bot schreibt keine Ressourcen gut und erzeugt keine Schiffe außerhalb der regulären Queues.
- Er verkürzt keine Reise-, Bau-, Forschungs- oder Abbauzeit.
- Eigentum, Sichtbarkeit, Freischaltungen, Kosten und Kapazitäten prüft derselbe Domain-Service wie
  bei einer Spieleraktion.
- Pro fälliger Entscheidung wird höchstens eine erfolgreiche Aktion ausgelöst.
- Ohne gültige Aktion wartet der Bot ohne Ausgleich.
- Ein atomarer Claim auf `nextDecisionAt` verhindert doppelte Entscheidungen.

Der persistente Controller speichert Benutzer, Strategie, Profil, den nächsten
Entscheidungszeitpunkt, ein kompaktes aktives Ziel, den Blockadezähler und die letzte Entscheidung.
Snapshots, Aktionsqueues, Ziel-JSON, Behavior Trees und ein eigener Bot-Prozess sind nicht
erforderlich.

## Strategie `goal_v1`

Die zielorientierte Strategie verwendet elf Zieltypen, vier Profile und eine gewichtete
Score-Funktion. Die Kandidatenerzeugung und -bewertung ist dokumentiert in
`docs/goal-driven-bots-plan.md`.

### Profile

| Profil        | futureWeight | riskWeight | Kolonisationsfaktor | Aggressionsfaktor |
| ------------- | -----------: | ---------: | ------------------: | ----------------: |
| Industrieller |          1,0 |        1,3 |                 0,8 |               0,5 |
| Pionier       |          1,1 |        1,0 |                 1,5 |               0,7 |
| Technokrat    |          1,5 |        1,0 |                 0,9 |               0,8 |
| Warlord       |          0,9 |        0,7 |                 0,8 |               1,5 |

Jedes Profil kann Ziele aller Kategorien wählen. Die Kategoriegewichte des Profils sind nur
Startgewichte; jeder Bot lernt eigene Gewichte (`bot_controllers.category_weights`, `null` =
Startgewichte):

- abgeschlossenes Ziel: Kategorie +0,10
- Ziel nach fünf `blocked`-Intervallen freigegeben: Kategorie −0,15
- jedes `saving`-Intervall des aktiven Ziels: Kategorie −0,03
- danach rückt jede Kategorie pro Entscheidung 2 % zurück zum Startgewicht; Grenzen 0,4–2,0

So verdrängen Bedarf und Gelegenheit (`baseNeed`, `opportunity`) ein stagnierendes Ziel, ohne dass
das Profil seinen Spielstil verliert.

### Elf Zieltypen

| Zieltyp               | Kategorie | Beschreibung                                            |
| --------------------- | --------- | ------------------------------------------------------- |
| `stabilize_station`   | economy   | Verfügbaren Miner zuweisen, sonst Mole und Lager bauen  |
| `increase_income`     | economy   | Drei Mole und einen Titan aufbauen                      |
| `increase_capacity`   | economy   | Warehouse/Hangar/Laboratory bei Engpass ausbauen        |
| `research_technology` | research  | Nutzenbringende Technologie erforschen                  |
| `explore_sector`      | expansion | Frontier-Sektor per Expedition entdecken                |
| `establish_colony`    | expansion | Kolonie in entdecktem Sektor gründen                    |
| `fortify_station`     | conflict  | Station mit Defense-Upgrades befestigen                 |
| `build_strike_force`  | conflict  | Kampfflugzeuge für Angriffsziel bauen                   |
| `raid`                | conflict  | Opportunistischen Angriff auf sichtbare Station fliegen |
| `retaliate`           | conflict  | Vergeltung gegen bekannten Angreifer                    |
| `salvage`             | economy   | Wertvolles Trümmerfeld bergen                           |

### Zielbindung

Ein aktives Ziel bleibt gebunden, bis ein anderes Ziel mindestens 25 % höher bewertet wird,
das Ziel abgeschlossen ist oder fünf aufeinanderfolgende Entscheidungsintervalle `blocked` waren.
`saving` und `waiting` behalten das Ziel und gelten nicht als Fortschritt oder Blockade. Das aktive
Ziel erhält einen Commitment-Bonus von 25 Punkten, der ohne Fortschritt binnen 30 Minuten auf 0
abklingt; Fortschritt eines früheren Ziels zählt nicht.

### Mehrere Stationen

Jede Station verwendet eigene lokale Ressourcen, Schiffe und Reserven. Profile, Zielbewertung und
Konfliktgeschichte sind accountweit.

### Ressourcenpfade

Ein Bot bewertet nicht nur, ob er die Kosten des nächsten Schritts bereits besitzt. Für jeden
fehlenden Rohstoff muss zusätzlich ein sichtbares, noch nicht erschöpftes Vorkommen und ein
nutzbarer Minerpfad existieren: ein freier beziehungsweise im Bau befindlicher Miner oder eine
bereits passende Abbauzuweisung. Ist ein Miner frei, wird er gezielt zu einem Vorkommen geschickt,
das einen fehlenden Rohstoff für das aktive Ziel liefert. Ohne Beschaffungspfad wird ein Ziel nicht
als dauerhaftes `saving` behandelt, sondern verworfen beziehungsweise nach der Blockadegrenze
freigegeben. Die benötigte Menge muss außerdem vollständig in das lokale Ressourcenfach passen;
ein Vorkommen allein macht Kosten oberhalb der aktuellen Lagerkapazität nicht erreichbar.

Die Asteroidenwahl berücksichtigt Entfernung, Lieferrate und den Anteil, den die konkrete Station
noch lagern kann. Ein volles Carbonlager schließt daher Carbonvorkommen aus, verhindert aber nicht
die Förderung eines weiterhin lagerbaren Rohstoffs. Steigt ein einzelner Lagerbestand über
85 Prozent, erhält ein erreichbares Warehouse-Upgrade eine levelunabhängig hohe Zielpriorität.
Nach einem Kapazitätsupgrade wird der konkrete Engpass neu bewertet; ist er behoben oder hat ein
anderer erreichbarer Engpass Vorrang, wird das bisherige Kapazitätsziel abgeschlossen.

### Mobile Reserve und Expansion

Eine produktive Station mit mindestens drei Minern hält grundsätzlich einen freien mobilen Miner
zurück. Während eines aktiven Expeditions- oder Kolonisationsziels wird der letzte freie Miner
ebenfalls nicht automatisch dem Bergbau zugeteilt. Fehlt das Missionsschiff, bereitet das Ziel
seine Voraussetzungen über die normalen Spieleraktionen vor: Shipyard beziehungsweise Hangar
ausbauen, eine Mole bauen und anschließend die Mission starten. Die Stationswahl darf dafür eine
eigene Station ohne aktuell freies Schiff wählen, solange dieser Vorbereitungspfad erreichbar ist.

Warlords ohne sichtbaren fremden Kontakt priorisieren Scanner und Exploration. Die Suche ist auf
zwei abgeschlossene Expeditionen je eigener Station begrenzt; eine neue Kolonie erweitert das
Budget. Sobald eine fremde Station sichtbar ist, endet dieser Kontaktbonus und der Bot bewertet
Ausbau, Verteidigung und Konflikt wieder regulär. Gezählt werden ausschließlich tatsächlich
abgeschlossene Expeditionsmissionen aus dem persistenten Missionsverlauf.

## Ausführung

Der API-interne Welttakt verarbeitet zuerst fällige Reisen, Upgrades und Bauaufträge, anschließend
Weltmissionen und Bot-Entscheidungen. `nextDecisionAt` bleibt in PostgreSQL, damit ein Neustart
keinen Bot zurücksetzt. Erwartete Domain-Fehler führen erst beim nächsten regulären Termin zu einem
neuen Versuch.

## Sichtbarkeit

Innerhalb eines eigenen Scannerkreises sichtbar sind fremde Stationen sowie informationsarme
Radarkontakte mit aktueller Position, Bewegungsrichtung und grober Signatur. Route, Gruppengröße,
Ladung, Bestände, Bauaufträge und interne Entscheidungsgründe bleiben verborgen. Die
Weltprojektion filtert serverseitig; das Frontend ist keine Sicherheitsgrenze.

## Erweiterungsregel

Eine neue Bot-Fähigkeit kommt erst hinzu, wenn:

1. die Spielermechanik und ihr Domain-Service existieren;
2. Zeit, Kosten, Ergebnis und Konkurrenz transaktional abgesichert sind;
3. UI und Verhaltenstest den Spielerpfad abdecken;
4. der Bot denselben Service ohne Sonderregeln aufrufen kann.

Weitere Strategien, Handel, Betriebskosten und Diplomatie bleiben bis zu einem konkreten
spielerischen Bedarf aus. `goal_v1` kann Wirtschaft, Forschung, Exploration, Kolonisation, Kampf
und Bergung über die jeweiligen Spieler-Services ausführen.

## Verbindliche Prüfungen

- Bots können fremdes Eigentum und Sichtbarkeitsregeln nicht umgehen.
- Parallele Ticks erzeugen höchstens eine Entscheidung.
- Neustarts holen überfällige Entscheidungen genau einmal nach.
- Bot-Mining, Bau, Upgrades, Forschung, Weltmissionen, Kampf und Bergung verwenden dieselben Daten
  und Kosten wie Spieleraktionen.
- Ressourcen entstehen nur aus Startausstattung und regulären Lieferungen.
- Öffentliche Weltantworten enthalten keine privaten Wirtschaftsdaten.
