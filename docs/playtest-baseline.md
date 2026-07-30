# Playtest-Baseline für Schritt 2

Stand: 30. Juli 2026.

## Abnahmegegenstand

Diese erste Mehrseed-Baseline bewertet den beschleunigten Spieltest, nicht bereits die
Spielbalance. Während PT-15 wurden keine Kosten, Profilgewichte, Schutzzeiten, Weltressourcen oder
Bot-Präferenzen verändert.

- Git-Basis: `59ced3027bb2ae7afe8faff2f1bfd403de4c390d`
- Abnahmegegenstand: Arbeitsbaum mit PT-01 bis PT-15 auf dieser Git-Basis
- Report-Schema: `1.0.0`
- Strategie: `goal_v1`, Version `1`
- Preset: [`configs/playtest/baseline-24h.json`](../configs/playtest/baseline-24h.json)
- Ausführung: `npm run playtest:baseline`
- Zeitpunkt: 30. Juli 2026, Zeitzone Europe/Berlin

Jeder Seed lief durch `scripts/run-playtest.mjs` in einem neuen Compose-Projekt mit eigener
PostgreSQL-Instanz auf `tmpfs`. Nach jedem Lauf wurden Container und internes Netzwerk entfernt.
Die Rohberichte liegen lokal unter `artifacts/playtests/` und werden nicht versioniert.

## Effektive Konfiguration

| Einstellung            | Wert                         |
| ---------------------- | ---------------------------- |
| virtueller Start       | `2030-01-01T00:00:00.000Z`   |
| Dauer / Schritt        | 24 Stunden / 60 Sekunden     |
| synthetische Spieler   | 12                           |
| Beitrittsabstand       | 15 Minuten                   |
| Bewohner-Bots          | seedabhängig, hier jeweils 4 |
| Profile                | je Gewicht 1                 |
| Snapshotabstand        | 60 Minuten                   |
| Diagnosepuffer je Bot  | 2.000 Einträge               |
| Softlockfenster        | überwiegend 6 Stunden        |
| Kernmeilensteinfenster | 24 Stunden                   |
| Ausgabe im Runner      | `/app/artifacts/playtests`   |

Die drei Seeds waren `baseline-alpha`, `baseline-beta` und `baseline-gamma`.

| Seed             | Konfigurationshash | Weltchecksumme (gekürzt) | Bots | Ticks | harte Befunde |
| ---------------- | ------------------ | ------------------------ | ---: | ----: | ------------: |
| `baseline-alpha` | `13fda60b9be57201` | `138a2352408d…`          |   16 | 1.441 |             0 |
| `baseline-beta`  | `bcfc3e2f0e9abfe3` | `76393760b24f…`          |   16 | 1.441 |             0 |
| `baseline-gamma` | `8de8f9346891b0df` | `4a3e8a389ea2…`          |   16 | 1.441 |             0 |

Die Population umfasste insgesamt 13 Industrielle, 11 Pioniere, 15 Technokraten und 9 Warlords.
Damit ist jedes Profil mehrfach vertreten. Wiederholungen mit gleichem Seed wurden in PT-14
normalisiert bytegleich; die drei verschiedenen Checksummen belegen hier unterschiedliche Welten.

## Ergebnisübersicht

| Kennzahl                |    Alpha |     Beta |    Gamma |
| ----------------------- | -------: | -------: | -------: |
| Botentscheidungen       |   10.948 |   10.948 |   10.948 |
| Abschlussereignisse     |    4.823 |    4.493 |    5.180 |
| Zielabschlüsse          |       28 |       14 |       32 |
| gelieferte Ressourcen   |  107.575 |   93.360 |  112.825 |
| verworfene Ressourcen   |  126.615 |  124.952 |  137.402 |
| Warnungen               |       42 |       41 |       41 |
| Expeditionen / Kolonien |    0 / 0 |    1 / 0 |    2 / 2 |
| Angriffe / Bergungen    |    0 / 0 |    0 / 0 |    0 / 0 |
| Tickdurchsatz           |      4,5 |      4,6 |      4,4 |
| reale Laufzeit          | 5:19 min | 5:10 min | 5:28 min |

Alle Läufe endeten erfolgreich, enthielten weder doppelte Abschlüsse noch Regel-, Eigentums-,
Sichtbarkeits- oder Ressourcenverletzungen und schrieben einen validen öffentlichen Bericht.

## Ziele und Spielstile

Über alle Seeds wurden 1.079,98 Botstunden einem aktiven Ziel zugerechnet.

| Ziel                  | Zeitanteil | Auswahl | Abschluss | Wechsel | `saving` | `blocked` |
| --------------------- | ---------: | ------: | --------: | ------: | -------: | --------: |
| `increase_income`     |    34,35 % |      49 |         3 |       0 |   10.649 |         0 |
| `research_technology` |    26,08 % |      90 |        32 |      24 |    8.122 |       129 |
| `fortify_station`     |    18,53 % |       9 |         2 |       0 |    5.961 |         0 |
| `increase_capacity`   |     8,97 % |      11 |         0 |       0 |    2.679 |         0 |
| `stabilize_station`   |     6,99 % |      36 |        36 |      36 |    2.181 |         0 |
| `establish_colony`    |     4,59 % |     342 |         1 |      10 |       51 |     1.692 |
| `explore_sector`      |     0,50 % |       3 |         0 |       2 |        0 |         0 |

Die Profile spielen erkennbar unterschiedlich:

- Industrielle verbuchten alle drei Expeditionen, 16 Forschungen und 150.408 gelieferte Einheiten.
- Pioniere verbrachten zusammen 47,4 Stunden mit Kolonisation und 190,9 Stunden mit Einkommen,
  erreichten aber nur eine Kolonie.
- Technokraten verbrachten 216,87 Stunden mit Forschung; alle 15 erreichten die erste Forschung.
- Warlords verbrachten 200,08 Stunden mit Befestigung; alle 9 erreichten die erste Verteidigung,
  aber keiner griff innerhalb des 24-Stunden-Fensters an.

### Zielanteile je Seed

| Seed  | Einkommen | Forschung | Befestigung | Kapazität | Kolonie | Exploration |
| ----- | --------: | --------: | ----------: | --------: | ------: | ----------: |
| Alpha |   35,65 % |   31,25 % |     12,49 % |    8,79 % |  2,72 % |      0,00 % |
| Beta  |   22,83 % |   20,18 % |     31,99 % |   11,75 % |  5,71 % |      0,20 % |
| Gamma |   44,54 % |   26,77 % |     11,15 % |    6,36 % |  5,35 % |      1,31 % |

Betas hoher Befestigungsanteil ist ein seedabhängiger Ausschlag; Einkommen und Forschung bleiben
in allen drei Welten dominante Langfristziele.

## Meilensteine

Alle 48 Bots erreichten Mining und eine stabile Ausgangsstation. Zeitwerte sind Stunden seit dem
individuellen Beitritt.

| Profil        | Meilenstein        | erreicht |  Median |    Spannweite |
| ------------- | ------------------ | -------: | ------: | ------------: |
| Industrieller | erstes Mining      |    13/13 |  0,14 h |   0,14–0,17 h |
| Industrieller | erste Forschung    |    12/13 | 14,77 h |  3,17–17,37 h |
| Industrieller | erste Expedition   |     3/13 | 22,23 h | 21,66–22,44 h |
| Pionier       | erstes Mining      |    11/11 |  0,15 h |   0,14–0,17 h |
| Pionier       | erste Kolonie      |     1/11 | 20,45 h |             – |
| Technokrat    | erste Forschung    |    15/15 |  0,07 h |             – |
| Warlord       | erste Verteidigung |      9/9 |  0,07 h |             – |

Weitere Meilensteine: 32 abgeschlossene Forschungen, 9 Bots mit erster Verteidigung, 3
Expeditionen, 2 Kolonien, 1 stabilisierte Kolonie und 3 Industrielle mit drei Moles plus Titan.
Angriff, Vergeltung und Bergung wurden im 24-Stunden-Fenster nicht erreicht.

## Wirtschaft und Engpässe

Von 702.729 abgebauten Einheiten wurden 313.760 geliefert und 388.969 wegen voller Lager
verworfen. Der Verlustanteil beträgt damit 55,35 Prozent. Über alle Bots summierten sich 719
Botstunden mit vollem Lager; 237 Asteroiden wurden erschöpft.

| Profil        | Bots | geliefert | verworfen | Verlustanteil | volles Lager |
| ------------- | ---: | --------: | --------: | ------------: | -----------: |
| Industrieller |   13 |   150.408 |    68.490 |       31,29 % |        118 h |
| Pionier       |   11 |    69.339 |   118.748 |       63,13 % |        192 h |
| Technokrat    |   15 |    66.944 |   165.130 |       71,15 % |        264 h |
| Warlord       |    9 |    27.069 |    36.601 |       57,49 % |        145 h |

45 von 48 Bots erhielten `storage_capacity_bottleneck`. Die 6.012 als unerreichbar gezählten
Ressourcenbedarfe konzentrierten sich auf Warlords.

## Expansion, Konflikt und Bergung

- Alpha expandierte nicht.
- Beta führte eine Expedition ohne Kolonie aus.
- Nur Gamma erreichte zwei Expeditionen und zwei Kolonien; eine Kolonie stabilisierte sich nach
  rund 0,55 Stunden.
- Kein Seed erzeugte einen Angriff, Kampfverlust, Beute oder Trümmer.
- Entsprechend gab es keinen Collectorbau und keine Bergungsmission.

Null Konflikte sind für 24 Stunden noch kein belastbarer Beweis für falsches Kriegsverhalten:
Accountschutz gilt 24 Stunden und viele synthetische Accounts traten später bei. Der Befund ist
deshalb eine Messgrenze der kurzen Baseline. Dass alle Warlords zugleich ohne Expansion in einem
Ressourcenengpass blieben, ist dagegen bereits seedübergreifend.

## Softlockhinweise

| Warnung                                  | Anzahl | betroffene Profile    |
| ---------------------------------------- | -----: | --------------------- |
| `storage_capacity_bottleneck`            |     45 | I 10, P 11, T 15, W 9 |
| `repeated_action_without_progress`       |     34 | I 12, P 5, T 13, W 4  |
| `no_measurable_progress`                 |     30 | I 1, P 7, T 13, W 9   |
| `unreachable_resource_without_expansion` |      9 | W 9                   |
| `long_blocked_goal`                      |      6 | P 6                   |

Die Warnungen traten in allen drei Seeds in denselben fünf Kategorien auf. Typische
Wiederholungen waren Sparen auf Warehouse, Laboratory, Titan oder Guardian Cannon ohne
Fingerprint-Fortschritt. Die genaue Anzahl je Seed schwankte nur zwischen 41 und 42.

## Muster und Ausreißer

Seedübergreifende Muster:

- mehr als die Hälfte des Miningvolumens geht an vollen Lagern verloren;
- jedes Profil ist betroffen, Technokraten und Pioniere am stärksten;
- jeder Warlord bleibt ohne Expansion bei unerreichbaren Ressourcenbedarfen;
- mindestens 9 von 16 Bots je Seed zeigen sechs Stunden keinen messbaren Fortschritt;
- Konflikt und Bergung sind im gewählten Horizont nicht messbar;
- alle Ausgangsstationen stabilisieren sich und alle Bots minen, also ist der Startloop tragfähig.

Seedabhängige Ausreißer:

- nur Gamma gründet Kolonien;
- nur Beta und Gamma explorieren;
- Beta verbringt 31,99 Prozent der Zielzeit mit Befestigung, Alpha und Gamma nur rund 12 Prozent;
- die Ereignismenge reicht von 4.493 in Beta bis 5.180 in Gamma, obwohl die Entscheidungszahl
  identisch ist.

## Performance

Die finalen Läufe erreichten 4,39 bis 4,65 Ticks pro Sekunde, im Mittel 4,52. Ein virtueller Tag
mit 16 Bots dauerte 5:10 bis 5:28 Minuten. Linear wären sieben virtuelle Tage bei gleicher
Population ungefähr 37 Minuten; das 7-Tage-Preset mit bis zu 28 Bots dürfte darüber liegen.

Der Runner hält pro Tick die vereinbarte harte Invariantenprüfung ein. Eine spätere Optimierung darf
weder deren Frequenz reduzieren noch Domainpfade umgehen. `artifacts/` wurde bereits aus dem
Docker-Buildkontext ausgeschlossen; dadurch sank der beobachtete Kontext von rund 171 KB auf
61 KB, ohne die Simulation zu verändern.

## Ergänzender 7-Tage-Langlauf

Ein zusätzlicher Einzel-Seed-Lauf verwendete am 30. Juli 2026 das unveränderte
[`baseline-7d.json`](../configs/playtest/baseline-7d.json) mit Seed `langlauf-01`. Der erste
Versuch erkannte nach 21:29 virtuellen Stunden korrekt einen überfälligen Mining-Trip. Ursache war
die diskrete Claim-Grenze nach `modular_cargo_frames`: Die mathematische Kapazität 55 wurde als
Gleitkommazahl `55.00000000000001` an den ganzzahligen Claim übergeben. Mining und Bergung runden
die gemeinsame Kapazität nun erst an dieser Grenze auf ganze Ressourceneinheiten ab; ein
Integrationstest schützt den erforschten 55-Einheiten-Mole-Claim. Danach lief derselbe Seed
vollständig durch.

| Kennzahl                |  Ergebnis |
| ----------------------- | --------: |
| virtuelle Dauer         |    7 Tage |
| Welttakte               |    10.081 |
| maximale Population     |        32 |
| Botentscheidungen       |   140.432 |
| Abschlussereignisse     |    24.523 |
| harte Befunde           |         0 |
| Warnungen               |       108 |
| gelieferte Ressourcen   |   380.127 |
| verworfene Ressourcen   |   814.794 |
| Expeditionen / Kolonien |  139 / 10 |
| Angriffe / Bergungen    |     0 / 0 |
| Tickdurchsatz           |       9,1 |
| reale Laufzeit          | 18:27 min |

Von 1.194.921 abgebauten Einheiten wurden 68,19 Prozent verworfen. Alle 32 Bots erhielten einen
`storage_capacity_bottleneck`; hinzu kamen 29 Hinweise auf fehlenden messbaren Fortschritt, 20 auf
wiederholte Aktionen, 18 auf lange blockierte Ziele, 6 auf unerreichbare Ressourcen ohne Expansion
und 3 auf instabile Kolonien. Besonders sichtbar waren 21.203 blockierte
`research_technology`-Entscheidungen der Technokraten, 8.317 blockierte
`establish_colony`-Entscheidungen der Pioniere und 20.670 unerreichbare Ressourcenbedarfe der
Warlords.

### Warnungen im Detail

| Warnung                                  | Anzahl | Profile I / P / T / W | Einordnung                                                           |
| ---------------------------------------- | -----: | --------------------: | -------------------------------------------------------------------- |
| `storage_capacity_bottleneck`            |     32 |        6 / 7 / 11 / 8 | wirtschaftlich real, Dauertelemetrie bei Mehrstationen additiv       |
| `no_measurable_progress`                 |     29 |        3 / 7 / 11 / 8 | mindestens ein historisches 6h-Fenster, nicht zwingend Endstillstand |
| `repeated_action_without_progress`       |     20 |         3 / 4 / 5 / 8 | 15 Sparschleifen und 5 Wartephasen laufender Expeditionen            |
| `long_blocked_goal`                      |     18 |         2 / 6 / 8 / 2 | vor allem Forschung bei Technokraten und Kolonisation bei Pionieren  |
| `unreachable_resource_without_expansion` |      6 |         0 / 0 / 0 / 6 | echter Warlord-Ressourcenstillstand ohne Expedition                  |
| `unstable_colony`                        |      3 |         2 / 1 / 0 / 0 | drei gegründete Kolonien bleiben langfristig instabil                |

Die 18 Warnungen zu blockierten Zielen umfassen 30.530 blockierte Entscheidungen. Davon entfallen
21.343 auf acht Technokraten und 8.402 auf sechs Pioniere. Bei sechs Technokraten blieb es trotz des
langen Laufs bei genau einer abgeschlossenen Forschung; ihr Forschungsziel wurde nach jeder
Freigabe erneut gewählt, obwohl kein tragfähiger Einkommenspfad für die nächste Forschung
vorhanden war. Bei den Pionieren dominiert weiterhin `establish_colony`.

Die 20 Wiederholungswarnungen enthalten insgesamt 5.293 gleiche Entscheidungen. 15 Bots wiederholen
`saving`, vor allem für Guardian Cannon, Laboratory, Shipyard, Warehouse oder die erste Mole einer
Kolonie. Fünf Warnungen beziehen sich dagegen auf `waiting` während einer nachweislich laufenden
Expedition. Diese Fälle sind kein identischer Botfehler und müssen in der Warnungsauswertung
getrennt werden.

`no_measurable_progress` wird beim ersten unveränderten 6-Stunden-Snapshotfenster eines Bots
ausgelöst. Die Zahl 29 bedeutet deshalb, dass 29 Bots mindestens einmal ein solches Fenster hatten;
sie bedeutet nicht, dass 29 Bots am Testende noch feststeckten. Ähnlich fasst
`long_blocked_goal` derzeit alle blockierten Entscheidungen eines Bots zwischen erstem und letztem
Treffer zusammen, auch wenn Ziel oder Zustand zwischenzeitlich wechselten. Die sehr hohen
Technokraten- und Pionierwerte sind trotzdem eindeutig, kleine Trefferzahlen über lange Zeiträume
dagegen nicht.

Die 4.032 Stunden volles Lager sind kumulierte Stationsstunden. Vier Mehrstations-Bots liegen
dadurch zwischen 174 und 240 Stunden, obwohl der Lauf nur 168 Stunden umfasst; ihre aus der Summe
zurückgerechneten Warnfenster beginnen sogar vor dem virtuellen Teststart. Der Ressourcenverlust
von 68,19 Prozent belegt den Engpass unabhängig davon, aber Warnfenster und Dauer müssen künftig je
Station ausgewiesen werden.

Von zehn gegründeten Kolonien erreichten sieben den Stabilitätsmeilenstein. Die übrigen drei
blieben rund 48,5, 86,7 und 97,6 Stunden instabil. Betroffen sind zwei Industrielle und ein Pionier;
das Problem liegt daher nach der Gründung und ist nicht nur die bereits bekannte
Pionier-Kolonisationsblockade.

Der Lauf deckte die Zeit nach dem Accountschutz deutlich ab, erzeugte aber weiterhin keine
Angriffe, Kampftrümmer oder Bergungen. Der Bericht unterscheidet noch nicht sicher zwischen
fehlenden gültigen Angriffschancen und nicht gewählten Angriffen. Deshalb ist dies ein starker
Einzel-Seed-Befund, aber noch keine Abnahme von PB-05; dafür bleiben die drei dort festgelegten
7-Tage-Seeds und eine präzisere Chancenmetrik erforderlich.

## Abgeleitete Folgetickets

### PB-01 – Lagerverlust vor weiterem Mining priorisieren

- Priorität: P0.
- Messwert: 388.969 von 702.729 Einheiten verworfen (55,35 Prozent); 45/48 Bots mit
  `storage_capacity_bottleneck`.
- Betroffen: alle Seeds und Profile, besonders Technokraten (71,15 Prozent) und Pioniere
  (63,13 Prozent).
- Ziel: Gesamtverlust höchstens 25 Prozent und kein Profil über 35 Prozent, ohne den gelieferten
  Durchsatz um mehr als 10 Prozent zu senken.
- Änderungsspielraum: genau eine Regelgruppe aus Lagerpriorisierung, Minerdisposition oder
  Warehouse-Ausbau auswählen; keine gleichzeitige Kostenänderung.
- Abnahme: dieselben drei 24h-Seeds erneut ausführen und Verlust, Lieferung, volle-Lager-Zeit und
  Meilensteine vorher/nachher vergleichen.

### PB-02 – Warlords aus dem Ressourcenstillstand führen

- Priorität: P0.
- Messwert: 9/9 Warlords mit `unreachable_resource_without_expansion`, 6.012 unerreichbare
  Bedarfsentscheidungen insgesamt, 0 Warlord-Expeditionen.
- Betroffen: alle drei Seeds, ausschließlich Warlords.
- Ziel: höchstens 2/9 dauerhafte Warnungen; ohne erreichbaren lokalen Ressourcenpfad muss ein
  regulärer Expansions- oder Zielwechselpfad sichtbar werden.
- Änderungsspielraum: Warlord-Zielauflösung bei fehlenden Ressourcen; keine Defensekosten oder
  Weltressourcen gleichzeitig ändern.
- Abnahme: dieselben drei 24h-Seeds sowie anschließend dieselben drei 7d-Seeds ausführen.

### PB-03 – Pionier-Kolonisationspfad entblocken

- Priorität: P1.
- Messwert: 6/11 Pioniere mit `long_blocked_goal`, 342 Kolonieziel-Auswahlen und 1.692
  `blocked`-Ergebnisse, aber nur eine Pionierkolonie.
- Betroffen: alle Seeds; Kolonieerfolg nur in Gamma.
- Ziel: höchstens 1/11 Pioniere mit lang blockiertem Kolonieziel und mindestens ein erklärbarer
  Fortschrittsschritt pro Seed, ohne Kolonisationskosten zu umgehen.
- Änderungsspielraum: Voraussetzungen- und Fallbackreihenfolge des Kolonieziels; Kosten bleiben im
  ersten Versuch unverändert.
- Abnahme: dieselben drei 24h-Seeds, mit Blockadedauer, Expeditionen, Kolonien und
  Stabilisierungszeit als Vergleich.

### PB-04 – Wiederholtes Sparen ohne Zustandsfortschritt auflösen

- Priorität: P1.
- Messwert: 34/48 Bots mit `repeated_action_without_progress` und 30/48 mit
  `no_measurable_progress`; typische Gründe betreffen Warehouse, Laboratory, Titan und Guardian
  Cannon.
- Betroffen: alle Seeds und Profile.
- Ziel: beide Warnungszahlen mindestens halbieren, ohne Mining-, Forschungs-, Verteidigungs- oder
  Koloniemeilensteine zu verschlechtern.
- Änderungsspielraum: genau eine Fallback-/Neubewertungsregel für Sparziele; keine Kostenänderung
  im selben Ticket.
- Abnahme: dieselben drei 24h-Seeds und Warnungsbelege je Profil vergleichen.

### PB-05 – Konflikt und Bergung über sieben Tage vermessen

- Priorität: P1, Messlücke vor Balanceänderung.
- Messwert: 0 Angriffe, 0 Trümmer, 0 Bergungen in 48 Bot-Tagen; das Fenster überlappt weitgehend
  mit dem 24-Stunden-Accountschutz.
- Zusatzbefund: Auch `langlauf-01` erzeugte in sieben Tagen 0 Angriffe und
  `warlord_without_attack_chance` wurde bei 8 Warlords nie ausgelöst. Die bisherige
  Reason-Regex ist damit keine verlässliche Chancenmetrik.
- Betroffen: alle Seeds und Profile; besonders Warlords.
- Ziel: mit `baseline-7d.json` die Zeit nach Schutzende vollständig abdecken und Angriffsgelegenheiten
  von fehlender Angriffsentscheidung unterscheiden. Erst bei vorhandener Gelegenheit entsteht ein
  Balance-Folgeticket.
- Änderungsspielraum: in diesem Ticket keine Spielregel; nur Auswertung und gegebenenfalls
  präzisere Chancenmetrik.
- Abnahme: Der Collector zählt pro Warlord und Tick sichtbare Ziele, nach Schutz und Cooldown
  gültige Ziele, ausreichende Flotte und Reserve sowie den Grund der letzten Ausschlussstufe.
  Danach `baseline-alpha`, `baseline-beta` und `baseline-gamma` mit dem 7d-Preset erneut ausführen
  und Konflikt, Reserve, Chancen, Schutzablehnung, Trümmer und Bergung vergleichen.

### PB-06 – Queue-Auslastung ereignisbasiert messbar machen

- Priorität: P2, Telemetriequalität.
- Messwert: nur 1 aktives Queue-Sample bei 1.125 Stations-Samples, obwohl 170 Gebäude-, 28
  Defense-, 81 Schiffbau- und 32 Forschungsabschlüsse beobachtet wurden.
- Betroffen: alle Seeds und Profile.
- Ziel: Auslastung aus belegten Start-/Endintervallen oder ausreichend dichter Beobachtung
  bestimmen, sodass kurze Queues nicht systematisch als null erscheinen.
- Änderungsspielraum: ausschließlich Playtest-Telemetrie; keine Queue- oder Bauzeit ändern.
- Abnahme: dieselben drei Seeds; spielrelevanter normalisierter Verlauf muss identisch bleiben.

### PB-07 – Langlaufdurchsatz ohne schwächere Prüfung erhöhen

- Priorität: P2, Werkzeugperformance.
- Messwert: 4,39–4,65 Ticks/s; ungefähr 5:19 Minuten je 24h-Lauf mit 16 Bots.
- Betroffen: alle Seeds und Profile; relevant für das 7d-Preset.
- Ziel: mindestens 8 Ticks/s auf derselben lokalen Referenzumgebung.
- Änderungsspielraum: Abfragen bündeln, unveränderliche Prüfgrundlagen cachen und
  Container-Buildarbeit vermeiden; keine Invariantenfrequenz oder Domainregel reduzieren.
- Abnahme: gleicher 2h-Smoke und dieselben drei 24h-Seeds; normalisierte Berichte bleiben
  identisch, Tickrate wird vorher/nachher dokumentiert.

### PB-08 – Technokraten aus der Forschungswiederwahl lösen

- Priorität: P0.
- Messwert: 21.203 blockierte `research_technology`-Entscheidungen; 6/11 Technokraten schließen nur
  eine Forschung ab und wählen danach denselben nicht tragfähigen Forschungsweg wiederholt neu.
- Betroffen: Technokraten ohne aktives Einkommen nach ihrer ersten Forschung.
- Ziel: kein Technokrat bindet sich erneut an dieselbe unbezahlbare Forschung, solange sich
  Einkommen, erreichbare Ressourcen oder Laboratory-Kapazität nicht verbessert haben; blockierte
  Forschungsentscheidungen sinken um mindestens 90 Prozent.
- Änderungsspielraum: Kandidatenscore und Fallback von `research_technology`; keine Forschungs-,
  Gebäude- oder Ressourcenkosten gleichzeitig ändern.
- Abnahme: `langlauf-01` sowie die drei 24h-Baseline-Seeds erneut ausführen; Forschungsabschlüsse
  dürfen nicht sinken, blockierte Entscheidungen und lange Forschungsblockaden werden verglichen.

### PB-09 – Gegründete Kolonien zuverlässig stabilisieren

- Priorität: P1.
- Messwert: 3/10 Kolonien bleiben 48,5 bis 97,6 Stunden instabil; betroffen sind zwei
  Industrielle und ein Pionier.
- Betroffen: der wirtschaftliche Aufbau nach erfolgreicher Stationsgründung, getrennt von der
  Pionier-Blockade vor der Gründung.
- Ziel: Jede gegründete Kolonie erreicht innerhalb von 24 Stunden den Stabilitätsmeilenstein oder
  wechselt nachvollziehbar auf einen konkreten Ressourcen- beziehungsweise Einkommensschritt;
  höchstens eine Kolonie pro 7-Tage-Lauf bleibt instabil.
- Änderungsspielraum: Stabilisierungsschritte und Mehrstationspriorisierung; keine
  Kolonisationskosten oder Startressourcen gleichzeitig ändern.
- Abnahme: derselbe 7-Tage-Seed mit Koloniegründung, erster Mole, erstem Mining und
  Stabilitätsdauer je Kolonie vergleichen.

### PB-10 – Softlockwarnungen zeitlich und fachlich präzisieren

- Priorität: P1, Telemetriequalität.
- Messwert: vier Speicherwarnfenster beginnen vor dem Teststart; `long_blocked_goal` verbindet
  nicht zusammenhängende Ziele; fünf Wiederholungswarnungen sind reguläres Warten auf Expeditionen;
  `no_measurable_progress` beschreibt nur das erste historische 6h-Fenster.
- Betroffen: Warnungsinterpretation und daraus abgeleitete Balanceentscheidungen, nicht die
  Spielsimulation.
- Ziel: Warnfenster liegen innerhalb Teilnahme und Laufzeit; Speicherdauer wird je Station als
  Stationsstunden ausgewiesen; Blockaden gelten für eine zusammenhängende Kombination aus
  Zieltyp und Zielreferenz; laufende terminierte Arbeit ist kein erfolgloser Wiederholungsversuch;
  Fortschrittswarnungen unterscheiden erstes, längstes und am Testende aktives Fenster.
- Änderungsspielraum: Collector, Snapshot und Softlockanalyse; keine Domainregel oder
  Warnschwelle verändern.
- Abnahme: reine Detektortests für Zielwechsel, Mehrstationssummen, laufende Expedition und
  historischen gegenüber aktuellem Stillstand sowie derselbe 7-Tage-Seed; spielrelevanter Verlauf
  und Metriken bleiben identisch, nur Warnungsbelege ändern sich.

## Schlussfolgerung

Das Werkzeug liefert reproduzierbare, isolierte und hinreichend detaillierte Baselines. Die
Startwirtschaft funktioniert, die vier Profile unterscheiden sich sichtbar und die technische
Invariantenebene blieb über insgesamt 14.404 dokumentierte Welttakte sauber. Die erste
Balanceaussage ist jedoch ebenfalls eindeutig: Lagerüberlauf und daraus folgende Stillstände
müssen vor feineren Profilgewichten untersucht werden. Konflikt und Bergung benötigen zunächst
eine explizite Chancenmetrik und die drei festgelegten 7-Tage-Seeds statt eine voreilige
Regeländerung.
