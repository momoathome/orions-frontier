# Audit-Ledger

Gedächtnis für wiederholte Repo-Audits (`.claude/workflows/audit-loop.js`). Ein Audit liest diese
Datei zuerst und meldet nichts, was hier als erledigt oder bewusst offen steht, außer der Fix ist
nachweislich kaputt oder unvollständig.

## Schwelle

Ein Befund zählt nur, wenn er ein konkretes Fehlerszenario hat (Eingabe oder Zustand → falsches
Ergebnis) und mindestens eines davon trifft:

- **Zustand:** Eine Transaktion ist nicht atomar, ein Wettlauf oder Deadlock ist möglich, zeitliche
  Arbeit läuft doppelt oder gar nicht, nach einem Neustart oder Aufholen stimmt die Reihenfolge nicht.
- **Regel:** Rohstoffe, Schiffe oder Kosten entstehen oder verschwinden; Ownership greift nicht; Bots
  umgehen eine Spielerregel.
- **Sichtbarkeit:** Der Server liefert private oder scannerbegrenzte Daten an Unbefugte.
- **Sicherheit:** Auth, Eingabeprüfung an der Vertrauensgrenze, Konto-Übernahme.
- **Betrieb:** Start, Migration oder `npm run verify` scheitert; Last bei angenommener Größe (ein
  API-Prozess, einige hundert Spieler plus Bots, überlappende Deploys) bringt den Tick oder die API zum
  Stau.
- **Spieler blockiert:** Ein Spieler oder Bot kommt ohne Neuladen oder Eingriff nicht weiter
  (Softlock, Endlosschleife, kaputter Hauptablauf im Frontend).

Unter der Schwelle (nicht melden, nicht fixen): Refactorings, lange Funktionen, toter Code, Duplikate
ohne nachweisbares Auseinanderlaufen, Benennung, kosmetische UI, Kennzahlen-Genauigkeit im Playtest,
reine Effizienz ohne Stau, alles erst ab mehreren API-Prozessen.

## Bevorzugte Fixes

- Ursache einmal früh abfangen (Schema an der Vertrauensgrenze, gemeinsamer Helfer, DB-Constraint,
  zentrale Sperre) statt denselben Check in jedem Service.
- Sperren: feste Reihenfolge (Benutzer → Station → Flotte → Ziel), `FOR UPDATE` in einer kurzen
  Transaktion, Advisory-Locks mit Namensraum (`'<bereich>:' + id`), keine Netzwerk- oder Realtime-
  Aufrufe in der Transaktion.
- Warteschlangen und Timer: fällige Arbeit atomar beanspruchen (`FOR UPDATE SKIP LOCKED` oder
  bedingtes `UPDATE … WHERE status = …`), Abschluss idempotent, Zeitpunkt aus der Zeile, nicht aus
  der Uhr des Ticks.

## Erledigt (Runden 1–4, Commits bis `f0efe24`)

- Bots: Übernahme reservierter Bot-Konten, zerstörte Bot-Stationen kehrten zurück, Rejected-Intent
  fror den ganzen Bot ein, Vergeltung und Verteidigungsausbau blockierten sich selbst, Collector ohne
  Forschung, Strike-Force ohne Höchststufe, Salvage-Sparen ohne erreichbaren Rohstoff, Forschungsgebäude
  an falscher Station, `lastProgressAt` bei Wartung, doppelte `availableFighterAttack`, Bot-Tick-Limit
  und eingefrorene Uhr, Abfragen pro Station.
- Zustand und Zeit: Welt-Tick unter `pg_try_advisory_lock`, Migrationen unter Advisory-Lock, Bau,
  Schiffe und Forschung vor Kämpfen im Aufholen, Deadlocks Bergung und Bergbau (Sperr-Reihenfolge),
  volle Warteschlange blockierte sofort startbare Aufträge, Erstattung mit bezahlten Kosten
  (`paid_cost`), `sumHomeboundGroupSize` entfernt.
- Sichtbarkeit: Fracht fremder Abbauer, ungescannte Asteroiden in Abbauaufträgen, genaue Integrität im
  Kampfbericht, Bergungsflüge außerhalb der Scanner-Reichweite, Aufschlüsselung in der Rangliste.
- Auth und Eingaben: E-Mail und Name kleingeschrieben und getrimmt, `23505` → `ALREADY_EXISTS`,
  Migration 0021 mit Kollisionen, gesperrte Konten und abgelaufene Tokens am WebSocket, `trustProxy`,
  Koordinaten-Grenzen, `npm start` entfernt.
- Frontend: Karte nach Stationsverlust, Ankunfts-Timer in der Vergangenheit, Neuladen pro
  Transport-Tick und `debounced` mit Höchstwartezeit, WebSocket-Pong-Timeout, Token aus dem Auth-Store,
  Chunks nach Reconnect, leerer Asteroid sperrte Stationsansicht, „Target already destroyed“,
  `BuildForm`-Watch, Scanner-Beschriftung, Logbuch-„neu“ pro Konto, Load-More-Fehler, Admin-Bypass im
  `TripLayer`, Tastatur-Liste für Asteroiden.
- Playtest: `cancelled`-Missionen, Vergeltungs- und Softlock-Kennzahlen, `fleet_lock_mismatch`.
- Rest: leere Trümmerfelder, Autopilot-Score nach Restvorrat, eingehende Angriffe zuerst, diverse
  Lean-Funde (Duplikate, toter Code, Aufteilung von Kampf-, Bot- und Missionsfunktionen).

## Bewusst offen

Stellen mit `ponytail:`-Kommentar (`grep -rn 'ponytail:' apps packages`) sind akzeptierte Grenzen, solange
die angenommene Last gilt, darunter Realtime nur in einem Prozess, Ranking ohne Cache und der
Logbuch-Eintrag nach der Transaktion. Der Welt-Seed im Quellcode bleibt, solange das Repo privat ist.

## Runden

<!-- Der Workflow hängt hier pro Runde Datum, Bereich, Befund und Fix an. -->

### Runde 1 (2026-10-31)

- Zustand und Zeit: Aufholen arbeitete fällige Arbeit nicht in globaler Zeitreihenfolge ab (Flüge vor
  früher fälligem Bau, Warteschlangen aus veralteten Ständen, Folgeflüge zu spät); Fix: Aufholen geht
  schrittweise durch die fällige Arbeit in Zeitreihenfolge (`simulation.ts`). Ergänzt den älteren Fix
  „Bau, Schiffe und Forschung vor Kämpfen im Aufholen“.
- Missionen: Kolonie-Ankunft nicht mit `startColonization` serialisiert (doppelte Station im Sektor,
  Kolonie-Limit um eins überschreitbar); Fix: Ankunft nimmt zuerst den Benutzer-Lock.
- Bots: Bot merkte sich nur ein geschütztes Raid-Ziel und wechselte bis zu 24 h zwischen abgelehnten
  Angriffen; Fix: Liste aller geschützten Besitzer (Migration 0023).
- Sichtbarkeit: Abbau-Vorschau ignorierte „ohne sichtbares Erz existiert der Asteroid nicht“ (200 vs.
  404 verriet unerforschte Adern); Fix: ein gemeinsames `findVisibleAsteroid` für alle Lesezugriffe
  per ID.
- Frontend: Forschungs-Store lud bei Gebäudeabschluss und Stationsverlust nicht neu; Fix: Neuladen
  bei beiden Ereignissen. Nur teilweise geprüft: kein Frontend-Testlauf vorhanden, Browserprüfung
  steht aus.
- Geprüft, kein Befund: keine.
- Unter der Schwelle: vier Duplikate von „Aufholen nicht in Zeitreihenfolge“ (Bergbau-Lieferung vor
  Lagerausbau, Bau- und Forschungsaufträge zu spät gestartet, Folgeflüge nach späteren Flügen,
  Flüge vor Bau und Forschung im selben Tick) in den Fix oben aufgegangen.

### Runde 2 (2026-10-31)

- Behoben: keine.
- Übersprungen oder nur teilweise behoben: keine.
- Geprüft, kein Befund: Bots, Salvage-Generator (`salvage.ts`) prüft die Collector-Amortisation
  nicht, `stepSalvage` schon (auch bei Collector in der Werft); der Bot verschwendet dadurch nur
  Intervalle auf ein blockiertes Ziel. Keine Endlosschleife: nach der Freigabe gewinnen Forschungs-,
  Ausbau- oder Konfliktziele in `selectGoal` (`RELEASE_PENALTY` senkt nur das Wirtschaftsgewicht),
  „300/300 salvage:blocked“ nicht reproduzierbar; Werft-Fall ist nur eine kurze Verzögerung bis zum
  fertigen Collector.
- Unter der Schwelle: keine.
