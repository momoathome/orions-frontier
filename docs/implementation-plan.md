# Aktueller Entwicklungsstand

Stand: 30. Juli 2026.

Orion's Frontier besitzt einen spielbaren vertikalen Schnitt: Spieler und wirtschaftliche Bots
erschließen endliche Asteroiden, bauen Stationen und Schiffe aus und erweitern die persistente Welt
durch Exploration und Kolonisation. Kampf, Bergung, Einfluss und Forschung verwenden dieselben
Reise-, Kosten- und Zeitregeln.

## Leitentscheidungen

- PostgreSQL ist die Quelle der Wahrheit.
- WebSocket, Simulation und Scheduler laufen gemeinsam in der API.
- Fällige Vorgänge werden persistent gespeichert und nach einem Neustart nachgeholt.
- Spieler und Bots verwenden dieselben Stationen, Ressourcen, Schiffe, Aufträge und Services.
- Neue Abstraktionen und Systeme entstehen erst aus einem spielbaren Bedarf.
- Die Welt ist noch nicht produktiv; Entwicklungsdaten dürfen nach Schema- oder Generatorwechseln
  neu erzeugt werden.

Die fachlichen Verträge stehen in [Mining-Rundlauf](./mining-loop.md),
[Bot-System](./bot-system.md), [Weltgenerierung](./world-generation.md) sowie
[Scanner und räumliche Sichtbarkeit](./scanner-visibility-plan.md) und
[Stationskapazitäten](./station-capacities.md).

## Umgesetzt

- endlicher Mining-Rundlauf aus Hinflug, Claim bei Ankunft, Abbau, Rückflug und Lieferung;
- Teilbeladung, Konkurrenz, Recall, Offline-Fortschritt und Erschöpfung;
- sichtbare Stationen, Asteroiden, Reisen und Trümmerfelder auf der Weltkarte;
- persistente Bau-, Forschungs-, Expeditions-, Kolonisations-, Kampf- und Bergungsaufträge;
- gemeinsame Eigentums-, Kosten-, Freischaltungs- und Kapazitätsprüfung in Domain-Services;
- deterministische wirtschaftliche Bots ohne eigene Ressourcen- oder Simulationsregeln;
- zielorientierte Bot-Strategie (`goal_v1`) mit elf Zieltypen, vier Profilen, gewichteter
  Score-Funktion, 25-%-Hysterese und accountweiter Konfliktgeschichte;
- beschleunigter, seedbarer Spieltest mit expliziter virtueller Zeit, normalem Welttakt,
  synthetischen Spielern, harter Invariantenprüfung, Softlockanalyse und versioniertem Bericht;
- reproduzierbare 24-Stunden-Baseline über drei isolierte Welten mit dokumentierten
  Balance-Folgetickets;
- konfigurierbare Startwelt, sektorgebundene Bots und dynamisch wachsende Frontier;
- Hangarkapazität, Scannerreichweite, eigene Defense-Upgrades;
- stationseigene Scannerkreise, geschützte Weltobjekt-Aktionen und informationsarme Radarkontakte;
- indexgestützte räumliche Kandidatenabfragen und ein reproduzierbarer Scanner-Lastbericht;
- statische Checks, Build und datenbankgestützte Verhaltenstests über `npm run verify`.

## Aktuelle Arbeit

Schritt 2 (beschleunigter Spieltest) ist technisch abgeschlossen und gemäß
[Playtest-Baseline](./playtest-baseline.md) abgenommen. Die nächste Arbeit verändert nicht mehrere
Balancebereiche gleichzeitig, sondern prüft die dort abgeleiteten Folgetickets mit denselben Seeds.

Weitere Änderungen richten sich nach beobachteten Spielverläufen. Relevant sind insbesondere:

- Lagerverlust und wiederholtes Sparen ohne Fortschritt anhand der Mehrseed-Baseline reduzieren;
- Warlord-Ressourcenstillstand und Pionier-Kolonisationsblockaden getrennt untersuchen;
- Konflikt und Bergung zunächst über das vorhandene 7-Tage-Preset vermessen;
- Scannerreichweite, Radarfrequenz und Kontaktdarstellung anhand echter Sessions abstimmen;
- Vorräte, Flugzeiten, Bauzeiten und Flottenwachstum anhand echter Sessions abstimmen;
- Defense-Upgrades, Panzerung, Guardian-Kanone, Drohnen und Minenfeld im Kampfbalance testen;
- prüfen, ob erschöpfte Altsektoren durch Exploration und Kolonisation ausreichend tragfähig
  bleiben;
- neue Bot-Aktionen erst ergänzen, nachdem die entsprechende Spielermechanik stabil ist;
- Handel, Betriebskosten, Diplomatie oder Asteroiden-Nachschub nur bei nachgewiesenem Bedarf
  planen.

## Abnahme für neue Mechaniken

Eine neue Mechanik ist erst fertig, wenn:

1. ihre Regeln serverseitig in einem gemeinsamen Service liegen;
2. Eigentum, Sichtbarkeit, Kosten und konkurrierende Zugriffe transaktional abgesichert sind;
3. fällige Arbeit einen Neustart übersteht und höchstens einmal abgeschlossen wird;
4. die UI nur erlaubte öffentliche beziehungsweise eigene Daten zeigt;
5. ein kleiner ausführbarer Verhaltenstest den fachlichen Vertrag schützt;
6. `npm run verify` besteht.

Abgeschlossene Phasen und frühere Migrationsentscheidungen bleiben in der Git-Historie statt in
einem fortlaufend wachsenden Umsetzungsprotokoll.
