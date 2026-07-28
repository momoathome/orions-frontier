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

Der persistente Controller speichert nur Benutzer, Strategie, nächsten Entscheidungszeitpunkt und
die letzte Entscheidung. Snapshots, Aktionsqueues, Ziel-JSON, Behavior Trees und ein eigener
Bot-Prozess sind nicht erforderlich.

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

Jedes Profil kann Ziele aller Kategorien wählen; die Kategoriegewichte bevorzugen jedoch den
jeweiligen Spielstil.

### Elf Zieltypen

| Zieltyp               | Kategorie | Beschreibung                                            |
| --------------------- | --------- | ------------------------------------------------------- |
| `stabilize_station`   | economy   | Ersten Miner zuweisen, Mole bauen, Lager aufbauen       |
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

### Mehrere Stationen

Jede Station verwendet eigene lokale Ressourcen, Schiffe und Reserven. Profile, Zielbewertung und
Konfliktgeschichte sind accountweit.

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
spielerischen Bedarf aus. Kampf, Bergung, Forschung, Exploration und Kolonisation sind bereits
Spielermechaniken, werden von `economic_v1` aber bewusst noch nicht ausgewählt.

## Verbindliche Prüfungen

- Bots können fremdes Eigentum und Sichtbarkeitsregeln nicht umgehen.
- Parallele Ticks erzeugen höchstens eine Entscheidung.
- Neustarts holen überfällige Entscheidungen genau einmal nach.
- Bot-Mining, Bau und Upgrades verwenden dieselben Daten und Kosten wie Spieleraktionen.
- Ressourcen entstehen nur aus Startausstattung und regulären Lieferungen.
- Öffentliche Weltantworten enthalten keine privaten Wirtschaftsdaten.
