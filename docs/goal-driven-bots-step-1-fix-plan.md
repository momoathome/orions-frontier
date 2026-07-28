# Nachbesserungsplan für Goal-driven Bots – Schritt 1

Stand: 29. Juli 2026

Dieser Plan behebt die Abweichungen zwischen den Tickets GB-01 bis GB-19 und der ersten
Implementierung. Er ist zugleich die Abnahmeliste: Ein Arbeitspaket ist erst abgeschlossen, wenn
das beschriebene Verhalten durch einen fokussierten Test belegt ist.

## 1. Echte Aktionen statt Aktionsbeschreibungen

**Ziel:** Ein `goal_v1`-Bot verändert die Spielwelt ausschließlich über dieselben Services wie ein
Mensch.

- Die Zielschritte liefern typisierte Intents statt nicht ausgeführter `actionLabel`-Strings.
- Ein zentraler Dispatcher führt genau einen Intent pro Entscheidungsintervall aus:
  Minerzuweisung, Schiffsbau, Gebäudeausbau, Forschung, Expedition, Kolonisation,
  Verteidigungsausbau, Angriff oder Bergung.
- Der Dispatcher ruft die vorhandenen Domain-Services mit Bot-`userId`, Stations- und Ziel-ID auf.
- Erwartbare Domain-Ablehnungen werden als `waiting` oder `blocked` protokolliert; unerwartete
  Fehler bleiben sichtbar und werden nicht als Fortschritt gewertet.
- `lastAction`, `lastReason` und `lastProgressAt` werden erst aus dem tatsächlichen Ergebnis
  abgeleitet.

**Abnahme:** Ein Integrationstest weist für jede Intent-Familie mindestens eine echte persistente
Zustandsänderung oder einen echten gestarteten Auftrag nach. Pro Tick entsteht höchstens eine
Domain-Aktion.

## 2. Persistenter Ziel-Lebenszyklus

**Ziel:** Ziele bleiben über mehrere Intervalle gebunden und unterscheiden Fortschritt, Warten,
Sparen und echte Blockaden.

- Ein neues Ziel wird bereits beim Auswählen gespeichert, auch wenn sein erster Schritt spart oder
  wartet.
- Der aktive Schritt wird vor der Blockadebewertung ermittelt.
- `success` setzt `lastProgressAt` und `blockedCount` zurück.
- `saving` und `waiting` behalten das Ziel und erhöhen `blockedCount` nicht.
- Nur `blocked` erhöht den Zähler; nach fünf aufeinanderfolgenden Blockaden wird das Ziel
  freigegeben.
- Freiwillige Wechsel beachten die 25-Prozent-Hysterese. Laufende Missionen oder Aufträge bleiben
  gebunden, bis sie abgeschlossen oder dauerhaft blockiert sind.
- Dringende Wartung nutzt denselben Intent-Dispatcher und verbraucht höchstens die eine erlaubte
  Aktion des Intervalls.

**Abnahme:** Verhaltenstests decken Auswahl, Sparen, Warten, Erfolg, Blockadefreigabe, Hysterese und
das Ein-Aktions-Limit ab.

## 3. Vollständiger, sichtbarkeitskonformer Snapshot

**Ziel:** Entscheidungen beruhen auf dem vollständigen eigenen Zustand und ausschließlich regulär
sichtbaren fremden Daten.

- Pro eigener Station werden Ressourcen, Gebäude, Verteidigung, Flotten, Bauaufträge, Forschung,
  Asteroidenzuweisungen, Raumflüge, Weltmissionen, Kampfmissionen und Bergungsmissionen geladen.
- Laufender Bergbau wird aus Zuweisungen und Reisen erkannt, nicht aus Weltmissionen.
- Reservierte bzw. gebundene Schiffe werden nicht doppelt verplant.
- Fremde Stationen, Asteroiden und Trümmerfelder stammen nur aus der vereinigten Scannerabdeckung.
- Kampfberichte werden accountweit geladen, aber je Gegner und Ereigniszeit ausgewertet.
- Der Loader bündelt Abfragen und gruppiert Resultate in Maps, damit die Kosten nicht mit
  `Stationen × Datensätze` wachsen.

**Abnahme:** Ein Mehrstations-Integrationstest belegt vollständige eigene Daten, Scannerunion und
das Fehlen nicht sichtbarer fremder Informationen.

## 4. Wirtschaft, Forschung und Expansion

**Ziel:** Die friedlichen Zielketten können von der Ausgangsstation bis zur stabilen Kolonie
vollständig ausgeführt werden.

- `stabilize_station` prüft echte aktive Minerzuweisung und behebt in Reihenfolge freien Miner,
  ersten Mole-Bau sowie nachgewiesene Scanner- oder Lagerengpässe.
- `increase_income` erreicht mindestens drei Moles und einen Titan, ohne belegten Hangar oder
  bereits laufende Builds zu ignorieren.
- `increase_capacity` entsteht nur für einen bekannten Engpass und baut die passende Kapazität.
- Forschung berücksichtigt alle sechs Grundlagen, Laborvoraussetzungen, vorhandenes Einkommen,
  laufende Forschung und Profilgewichtung.
- Exploration und Kolonisation wählen für jeden Schritt die nächste geeignete eigene Station,
  reservieren Kosten und Miner und bleiben während der Mission im Zustand `waiting`.
- Eine Kolonie gilt erst nach eigener aktiver Rohstoffversorgung und ohne dauerhaften vollen
  Speicher als stabil.

**Abnahme:** Fokussierte Tests führen jede Zielkette über mindestens zwei Intervalle und prüfen
Mehrstationsauswahl, Ressourcenknappheit und Stabilisierung.

## 5. Konflikt, Reserve und Bergung

**Ziel:** Militärische und logistische Entscheidungen sind gegnerbezogen, sicher und wirtschaftlich
nachvollziehbar.

- Feindseligkeit wird je Gegner aus Angriffen und Verlusten der letzten 24 Stunden berechnet.
- Reservequoten berücksichtigen Profil, jüngste Angriffe, lokale Instabilität und laufende eigene
  Missionen.
- Angriff und Vergeltung wählen die nächste geeignete eigene Station und die kleinste einzelne
  Fightergruppe, die nach Reserve die Sicherheitsmarge erfüllt.
- Geschützte oder im Cooldown befindliche Ziele führen zu `waiting`; Übernahme bleibt vollständig
  ausgeschlossen.
- Bergung bewertet lokale Ressourcenbedarfe, tatsächlich freie Lagerkapazität, freie
  Bergungskapazität, Forschungsboni, Reisezeit und den Vergleich zum Bergbau.
- Ein zusätzlicher Collector ist nur zulässig, wenn sein anteiliger Ertrag seine Kosten innerhalb
  einer Reise mit 125 Prozent Sicherheitsfaktor deckt.

**Abnahme:** Tests prüfen Gegnertrennung, Reservegrenzen, kleinste Flotte, Quellenwahl,
Schutzablehnung, Mehrstations-Bergung und die Unwirtschaftlichkeitsgrenze.

## 6. Einheitliche Forschungswirkungen

**Ziel:** Vorschau, tatsächliche Auflösung und Bot-Schätzung verwenden dieselben sechs
Forschungsgrundlagen.

- Abbaurate, Frachtraum, neue Reisezeiten, Fighter-Angriff sowie neue Gebäude- und
  Verteidigungsausbauzeiten werden in den jeweiligen Domain-Services angewendet.
- Vorschauen und Bot-Nutzenberechnungen verwenden dieselben zentralen Effektfunktionen.
- Bereits laufende Reisen und Ausbauten werden durch später abgeschlossene Forschung nicht
  rückwirkend verändert.

**Abnahme:** Grenzwerttests vergleichen Baseline und erforschten Zustand in tatsächlicher
Auflösung, Vorschau und Bot-Projektion.

## 7. Abnahme- und Regressionstest

**Ziel:** Die 19 Tickets sind durch Verhalten statt durch Texte oder interne Labels abgesichert.

- Alle vier Profile dürfen wirtschaftliche, wissenschaftliche, expansive und militärische Ziele
  ausführen; ihre Präferenzen bleiben statistisch verschieden.
- Deterministische Gleichstände und wiederholte Läufe liefern dieselbe Entscheidung.
- Gleichzeitige Ticks erzeugen keine Doppelaktion.
- Tests prüfen persistierte Domain-Zustände, nicht nur `lastAction` oder Begründungstexte.
- Veraltete Tests und Dokumentation werden auf das tatsächlich implementierte Modell umgestellt.

**Abnahme:** `npm run check`, die kleinsten betroffenen Unit- und Integrationstests sowie
`npm run verify` laufen vollständig durch.

## Abschlussreview

Nach der Umsetzung wird der entstandene Diff nochmals unabhängig entlang dieser fünf Fragen
gelesen:

1. Entspricht das Verhalten den Verträgen und Tickets?
2. Ist die Umsetzung ohne bekannte P0-/P1-Abweichung abnahmefähig?
3. Belegen die Tests sinnvolle Zustandsänderungen und laufen sie vollständig?
4. Lassen sich Verzweigungen, Datenmodelle oder Abfragen ohne Regelverlust vereinfachen?
5. Vermeidet der Code unnötige Abfragen, quadratische Gruppierungen und mehrfaches Laden gleicher
   Konfiguration?

Gefundene Probleme werden vor der finalen Abnahme behoben oder ausdrücklich als Restpunkt mit
Auswirkung dokumentiert.
