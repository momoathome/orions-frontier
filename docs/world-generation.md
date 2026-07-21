# Weltgenerierung und persistente Frontier

Stand: Startwelt, dynamische Frontier, Exploration, Kolonisation und erste Balancing-Baseline sind
umgesetzt. Weitere Wertänderungen benötigen reale Spielverläufe.

Die Welt ist deterministisch, persistent und gemeinsam. Asteroiden besitzen endliche Vorräte und
werden nicht automatisch ersetzt. Neue Ressourcen entstehen zunächst durch Exploration und weitere
Stationen, nicht durch Respawn oder persönliche Parallelwelten.

## Startwelt

Eine frische Welt verwendet standardmäßig `INITIAL_SECTOR_RADIUS: 1` und erzeugt damit einen
zusammenhängenden Bereich von `3 x 3` Sektoren. `(0,0)` ist der erste Ansiedlungssektor, die acht
Nachbarn sind Frontier.

Stationskapazität und Botanzahl sind getrennt konfiguriert. Beim aktuellen Standard besitzt ein
Ansiedlungssektor acht Plätze, davon zwei Bot-Slots. Bereits persistierte Stationen werden durch
spätere Konfigurationsänderungen nicht verschoben oder gelöscht.

## Sektorrollen

### Ansiedlung

Ansiedlungssektoren besitzen Spieler- und Bot-Slots. Eine Startertasche entsteht erst bei der
Stationsgründung und enthält zwei Carbon-, zwei Titanium- und einen kleineren
Hydrogenium-Asteroiden. Danach sind diese Asteroiden öffentlich und folgen den normalen
Mining-Regeln.

Ist kein Spieler-Slot mehr frei, wird transaktional der nächste zusammenhängende
Ansiedlungssektor geöffnet. Gleichzeitige Gründungen dürfen weder denselben Slot noch denselben
neuen Sektor doppelt beanspruchen.

Bots werden erst mit dem ersten menschlichen Bewohner eines Ansiedlungssektors erzeugt. Sie
belegen normale Bot-Slots und erhalten dieselbe Stationsinitialisierung und Startertasche.

### Frontier

Frontier-Sektoren besitzen keine Startplätze oder Startertaschen. Sie enthalten dünnen
Hintergrund, größere gemeinsame Felder und eine seltene Ressourcenspezialisierung. Nach ihrer
Entdeckung können Spieler dort eine weitere Station gründen.

## Generator

Der aktive Generator besitzt genau einen Pfad:

1. Sektorgrenzen und reservierte Stationsbereiche bestimmen;
2. wenige ressourcenspezifische Wolken und Gürtel erzeugen;
3. einen dünnen Hintergrund verteilen;
4. Mindestabstände über ein räumliches Raster sichern;
5. Asteroiden mit endlichen, größenabhängigen Vorräten und Adern erzeugen.

Seed und Koordinaten bestimmen das Ergebnis vollständig. Persönlichkeiten, alternative
Generatorvarianten, Feature Flags, Legacy-Fallbacks und persistierte Field-Objekte existieren
nicht.

## Exploration

Die Kamera erzeugt keine Welt. Neue Frontier entsteht ausschließlich durch eine Spieleraktion:

1. Ein unbekannter angrenzender Sektor wird als Ziel angeboten.
2. Ein verfügbares Schiff startet eine persistierte Expedition.
3. Bei Ankunft wird der Zielsektor idempotent erzeugt und gemeinsam entdeckt.
4. Das Schiff kehrt mit derselben Reiseberechnung zurück und wird erst danach wieder verfügbar.

Die Eindeutigkeit von `(sectorX, sectorY)` verhindert, dass parallele Expeditionen denselben Sektor
mehrfach anlegen.

## Kolonisation

Eine entdeckte Frontier kann mit einer weiteren Station besiedelt werden. Die Aktion prüft
Eigentum, Scannerreichweite, Mindestabstand, Kosten und einen verfügbaren Miner. Der Miner wird bei
erfolgreicher Gründung aus der Ursprungsflotte in die Kolonie übertragen.

Eine Kolonie erhält keine Startertasche, kostenlosen Ressourcen oder zusätzlichen Schiffe. Sie
macht den Frontier-Sektor auch nicht zu einem Aufnahme-Sektor für neue Accounts.

## Seltene Ressourcen

Die Koordinatenparität bestimmt den Schwerpunkt:

```text
abs(sectorX + sectorY) gerade   -> Kyber
abs(sectorX + sectorY) ungerade -> Astatine
```

Die jeweils andere seltene Ressource entsteht dort weder als Primär-, Sekundär- noch Spurader.
Orthogonale Nachbarn besitzen dadurch automatisch unterschiedliche Schwerpunkte. Carbon, Titanium
und Hydrogenium bleiben die Grundversorgung von Ansiedlungssektoren.

## Erschöpfung und Balance

Ein erschöpfter Sektor bleibt bestehen. Stationen und Reisen werden nicht gelöscht. Automatischer
Asteroiden-Nachschub, private Vorkommen und unendliche Reserven sind nicht vorgesehen.

Die aktuelle Baseline schützt folgende Größenordnungen:

- Starterziele liegen ungefähr drei bis sieben Flugminuten entfernt.
- Ein erster voller Mole-Rundlauf dauert ungefähr eine Stunde.
- Drei Mole benötigen für einen Starterasteroiden mindestens einen Tag.
- Ein voll belegter Ansiedlungssektor besitzt bei drei Mole je Station ungefähr 30 bis 60 Tage
  Referenzvorrat.

Nachschub wird erst geplant, wenn reale Spielstände zeigen, dass Exploration und Kolonisation alte
Standorte nicht ausreichend tragfähig halten. Die kleinste mögliche Rückfalloption wären seltene
neue kleine Basisasteroiden mit erneut endlichem Vorrat.

## Verbindliche Prüfungen

- Derselbe Seed und dieselben Koordinaten erzeugen denselben Sektor.
- Es existiert nur ein aktiver Generatorpfad.
- Eine frische Welt enthält genau die konfigurierte zusammenhängende Sektormenge.
- Nur Ansiedlungssektoren besitzen Startplätze und Startertaschen.
- Spieler- und Botkapazität sind unabhängig konfigurierbar.
- Expeditionen erzeugen nur angrenzende unbekannte Sektoren und binden ihr Schiff bis zur Rückkehr.
- Eine Kolonie erhält genau den eingesetzten Miner und keine kostenlose Ausstattung.
- Spieler und Bots verwenden bei gemeinsamen Aktionen dieselben Kosten und Zeiten.
- Erschöpfte Asteroiden und Sektoren regenerieren nicht automatisch.
- Orthogonale Nachbarsektoren besitzen unterschiedliche seltene Schwerpunkte.
