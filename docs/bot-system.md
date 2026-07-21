# Bot-System

Stand: Die erste wirtschaftliche Strategie `economic_v1` ist umgesetzt.

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

## Strategie `economic_v1`

Die Entscheidung ist eine reine Funktion über einen kompakten Stationszustand. Ihre feste
Priorität lautet:

1. freien Titan einem geeigneten sichtbaren Asteroiden zuweisen;
2. andernfalls eine freie Mole zuweisen;
3. bis zu drei Mole über die reguläre Bau-Queue aufbauen;
4. das Shipyard bis Level 5 ausbauen;
5. einen Titan bauen und anschließend einsetzen;
6. andernfalls warten.

Asteroiden werden anhand der vorhandenen Mining-Rundlaufberechnung und des nächsten
Investitionsbedarfs bewertet. Unsichtbare und erschöpfte Ziele entfallen. Bei Gleichstand sorgt
die Asteroiden-ID für eine deterministische Reihenfolge.

## Ausführung

Der API-interne Welttakt verarbeitet zuerst fällige Reisen, Upgrades und Bauaufträge, anschließend
Weltmissionen und Bot-Entscheidungen. `nextDecisionAt` bleibt in PostgreSQL, damit ein Neustart
keinen Bot zurücksetzt. Erwartete Domain-Fehler führen erst beim nächsten regulären Termin zu einem
neuen Versuch.

## Sichtbarkeit

Öffentlich sichtbar sind Station, Position, Besitzerart und die zur Darstellung nötigen Reisedaten.
Private Bestände, Ladungen, Bauaufträge und interne Entscheidungsgründe bleiben verborgen. Die
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
