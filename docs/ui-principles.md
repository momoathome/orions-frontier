# UI-Grundsätze

Status: Zielbild und Regeln für die Überarbeitung der Spieler-UI. Neue oder geänderte Ansichten
werden an diesen Regeln gemessen.

## Problem

Die UI folgt der Interaktion eines RTS: erst auswählen, dann Informationen sehen. Ein Idle-Game wird
aber in Check-ins gespielt (siehe Session-Takt im [Design-Kompass](./design-compass.md)). Wer
zurückkommt, sieht ohne Auswahl fast nichts über Stationen, Flotte und Ressourcen. Mit Auswahl ist
alles auf acht Tabs verteilt, in Schrift von 7–10px.

Jeder Bildschirm muss drei Fragen beantworten:

1. **Was ist passiert**, während ich weg war?
2. **Was läuft gerade**, und wann ist es fertig?
3. **Was sollte ich jetzt entscheiden?**

Das Asteroid-Panel (nächstes Ereignis, nächste Lieferung, Erschöpfung in Stunden) beantwortet das
heute schon und ist das Vorbild für alle anderen Ansichten.

## Regeln

| #   | Regel                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Lesbarkeit.** Fließtext mindestens 13px, Labels mindestens 11px, spielrelevante Zahlen mindestens 14px. Nichts unter 11px.                             |
| R2  | **Lage ohne Klick.** Was Aufmerksamkeit braucht (Queue fertig, Schiffe idle, Lager fast voll, Angriff), ist ohne Auswahl sichtbar.                       |
| R3  | **Zeit statt Zustand.** Alles Zeitgebundene zeigt Countdown oder Fortschritt: „fertig in 4:12“ statt „active“.                                           |
| R4  | **Sperren erklären sich.** Statt „Insufficient resources“: was fehlt und wann es reicht („−120 Carbon · in ~20 min“).                                    |
| R5  | **Leere ist eine Aufgabe.** Ein leerer Zustand sagt, warum er leer ist, und bietet die nächste Aktion an. Eine fehlende Voraussetzung steht einmal oben. |
| R6  | **Richtige Ebene.** Kontoweites (Ranking, Logbook, Warnungen) gehört nicht in das Panel einer Station.                                                   |
| R7  | **Map nur für Räumliches.** Die Map zeigt, wo etwas ist; Panels und Listen zeigen, was es ist und was man tun kann.                                      |
| R8  | **Ein Vokabular.** Eine Kartenform, eine Zeilenform, feste Farben für Ressourcen und Zustände (outbound, mining, returning, Warnung, Gefahr).            |
| R9  | **Ereignis gibt Rückmeldung.** Ein abgeschlossenes Ereignis zeigt einen Toast und einen Logbook-Eintrag, der zum Objekt springt.                         |
| R10 | **Raum nach Wichtigkeit.** Keine halb leeren Flächen; die Map bleibt immer vollständig sichtbar.                                                         |

## Zielbild (Desktop)

```
┌─ Ressourcen: Wert · Rate/h · Lagerbalken ──── Logbook · Ranking #17 ─────────── 🔔3 ┐
├──────────────┬──────────────────────────────────────────────┬────────────────────────┤
│ LAGEBILD     │                                              │ DETAIL (Auswahl)       │
│ ⚠ 3 Mole idle│                                              │ Station / Asteroid /   │
│ ⚠ Lager 92%  │                    MAP                       │ Schiff: was läuft,     │
│ Stationen    │                                              │ wann fertig, was kann  │
│  Alpha ▓▓░ 2m│                                              │ ich tun                │
│ Operationen  │                                              │                        │
│  Mining 1:15 │                                              │                        │
│  Bau    4:12 │                                              │                        │
└──────────────┴──────────────────────────────────────────────┴────────────────────────┘
```

- **Top-Bar:** Ressourcen der gewählten Station, größer, mit Rate pro Stunde und Lagerfüllung.
  Logbook und Ranking öffnen kontoweite Overlays; die Glocke zählt ungelesene Ereignisse.
- **Lagebild (links, immer sichtbar):** Warnungen zuerst, dann jede Station mit ihrer Queue und dem
  nächsten Fertigstellungszeitpunkt, dann laufende Operationen mit Countdown, sortiert nach
  Fertigstellung. Ein Klick wählt das Objekt auf der Map und öffnet das Detail-Panel.
- **Map (Mitte):** wird nie von einem Panel verdeckt.
- **Detail-Panel (rechts):** ersetzt das untere Stations-Panel. Stationsbereiche bleiben Buildings,
  Fleet, Logistics, Frontier und Defense. Research ist account-weit und öffnet sich als Graph über
  die Top-Bar.

## Folgerungen für die Bereiche

- **Buildings:** Raster aus Karten in voller Breite. Jede Karte zeigt Effekt jetzt → nächste Stufe,
  Kosten mit fehlenden Ressourcen in Rot, Bauzeit und Upgrade direkt auf der Karte. Bezahlbares ist
  hervorgehoben (R4, R10).
- **Fleet:** Wofür ist das Schiff da, wo sind die Schiffe gerade (idle, unterwegs, an Asteroid X),
  Vergleich der Typen statt einzelner Balken ohne Bezug.
- **Logistics:** geht weitgehend im Lagebild auf; im Panel bleibt die Detailansicht.
- **Frontier:** eine Zeile „Explorer nötig → Shipyard“ statt „no ship available“ in jeder Zeile (R5).
- **Logbook:** Feed mit Icons, gruppiert nach „seit deinem letzten Besuch“, Einträge springen zum
  Objekt (R9).
- **Ranking:** eigener Rang groß, Nachbarn ±3, Zusammensetzung der eigenen Influence. Spieler brauchen einen
  Anzeigenamen; heute erscheinen generierte `user-<uuid>`-Namen.
- **Research:** Graph mit Detailpanel; Blocker als Chips, die zum fehlenden Gebäude springen (R3, R4).

## Datenlage

Stand 2026-10-29. Das Frontend hat außer `auth` keinen Store; jede Komponente lädt selbst.

Kontoweit vorhanden:

- `GET /stations` – eigene Stationen mit Integrität.
- `GET /me/trips` – alle laufenden Trips. Miner im Abbau stecken im Trip `mining_return`, dessen
  Abflug in der Zukunft liegt; die Phase liefert `getMiningTripPhase` aus `shared`.
- `GET /me/world-missions`, `GET /me/combats` (enthält eingehende Angriffe), `GET /me/logbook`,
  `GET /world/ranking`.
- WebSocket: `building_upgrade_completed`, `spacecraft_build_completed`, `defense_upgrade_completed`,
  `world_mission_completed`, `incoming_attack`, `resources_updated`, `mining_tick_completed`.

Nur pro Station, also ein Request je Station:

- `GET /me/resources?stationId=` – Bestand, Rate der letzten Stunde, Lagerkapazität.
- `GET /stations/:id/buildings` – `upgradeEndsAt` je Gebäude.
- `GET /stations/:id/spacecrafts` – `amount` und `lockedAmount` (idle = Differenz), `buildOrders`
  mit `endsAt`, Hangar.

Folgen:

- Das Lagebild lässt sich mit den vorhandenen Endpunkten bauen, kostet aber 3 Requests je Station.
  Bei mehreren Stationen lohnt ein kontoweiter Übersichts-Endpunkt; erst einführen, wenn das spürbar
  wird.
- Die Queue-Anzeige im Stations-Panel zählt nur, wenn Buildings- oder Fleet-Tab geladen wurden. Sie
  zeigt sonst „0 active“, obwohl gebaut wird.
- `/me/resources` wird von vier Komponenten getrennt geladen. Ein gemeinsamer Store für Stationen,
  Ressourcen und Queues ist die Voraussetzung für das Lagebild.

## Reihenfolge

1. **Typografie- und Abstandsskala** (R1): Skala festlegen, `text-[7px]` bis `text-[10px]` ersetzen.
2. **Gemeinsamer Store** für Stationen, Ressourcen, Queues und Trips, gespeist von den WebSocket-
   Ereignissen.
3. **Lagebild links** (R2, R3).
4. **Ranking und Logbook in die Top-Bar**, Detail-Panel nach rechts (R6, R10).
5. **Buildings und Fleet** nach R4 und R5 neu.
6. **Logbook als Feed mit Toasts** (R9), Anzeigenamen im Ranking, danach Research.
