# Services

Spielregeln der API als modularer Monolith. Routen, `src/index.ts`, `src/seed.ts` und `src/tools/`
rufen die Module auf; darunter liegt nur `lib/` (Basis). Jedes Modul besitzt seine Tabellen und fragt
sie in `<modul>/repositories/` ab. `npm run check:boundaries` (dependency-cruiser,
`.dependency-cruiser.cjs`) prüft alle Regeln hier.

## Regeln

- Ein Ordner ist eine fachliche Einheit. Von außen nur über seine `index.ts` importieren; sie
  exportiert genau das, was andere Ordner, Routen oder Werkzeuge brauchen. Innerhalb des Ordners
  direkt importieren, nie die eigene `index.ts`.
- Ein Ordner importiert nur Ordner **niedrigerer** Schichten, nie die eigene oder eine höhere.
  Braucht eine untere Schicht etwas von oben, kommt es als Parameter oder Rückgabewert.
- Keine Zyklen, auch nicht über reine Typ-Importe.
- `lib/` importiert keine Services. Routen fragen die Datenbank nicht selbst ab (außer
  `/health`), Services kennen weder Routen noch `tools/`.
- Services fragen die Datenbank nur über die **eigenen** Repositories ab. `drizzle-orm` und
  `lib/db/schema` importieren sie höchstens als Typ (`import type`); `getDb()`, `Tx` und `QueryDb`
  aus `lib/db` für Transaktionen bleiben erlaubt.
- Tests dürfen Interna direkt importieren.

## Datenhoheit

Jede Tabelle gehört genau einem Modul. Nur dessen Repositories lesen und schreiben sie; andere
Module, Routen und `tools/` bekommen die Daten über die `index.ts` des Besitzers. Der Besitzer
exportiert dort die Funktionen, die andere brauchen, mit fachlichem Namen (`payStationCosts`,
`reserveSpacecraft`, `listUserResearch`, …), nie das Repository selbst. Bots lesen so dieselben
Daten wie Spieler.

| Modul      | Tabellen                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `auth`     | `users`                                                                                                               |
| `research` | `user_research`                                                                                                       |
| `map`      | `sectors`, `asteroids`, `asteroid_veins`, `asteroid_assignments`, `spawn_slots`                                       |
| `logbook`  | `logbook_entries`                                                                                                     |
| `fleet`    | `spacecraft_trips`                                                                                                    |
| `station`  | `stations`, `station_resources`, `station_buildings`, `station_spacecrafts`, `spacecraft_build_orders`, `queued_jobs` |
| `missions` | `world_missions`                                                                                                      |
| `combat`   | `combat_missions`, `debris_fields`, `salvage_missions`                                                                |
| `bot`      | `bot_controllers`                                                                                                     |

Der Besitzer ist das unterste Modul, das die Tabelle braucht, damit alle anderen ihn über die
Schichten erreichen. Reisen liegen deshalb in `fleet` (Schicht 1), nicht in `transport`: Abbau,
Kampf, Station und Weltansicht lesen oder schreiben sie. `queued_jobs` gehört `station`, weil
Gebäude, Verteidigung und Forschung aus einer Station bezahlt und in einer Warteschlange
gestartet werden; die Forschungs-Warteschlange (`station/research-queue.ts`) liegt darum dort,
`research` behält Stufen und Effekte.

Transaktionen dürfen Modulgrenzen überqueren: Ein Modul öffnet `tx` und reicht ihn an die
Funktionen anderer Module weiter, damit ein Spielzug atomar bleibt. Wer `tx` öffnet, bestimmt die
Sperr-Reihenfolge.

Das Schema in `lib/db/schema` bleibt zentral; es ist der Vertrag für Migrationen und
`drizzle-kit`.

## Repositories

Liegen in `<modul>/repositories/`, eine Datei pro Schema-Datei in `lib/db/schema` (`stations.ts`,
`debris-fields.ts`, …); Kind-Tabellen wie `salvageMissions` gehören zur Datei ihrer Eltern-Tabelle.
Eine Abfrage mit Join liegt im Repository der Tabelle, deren Zeilen sie liefert; fremde Tabellen
darf sie dabei lesen, schreiben nur die eigenen.

- Einfache Funktionen, erster Parameter `db: QueryDb` (lesen, innerhalb oder außerhalb einer
  Transaktion) oder `tx: Tx` (schreiben, sperren). Der Service öffnet die Transaktion.
- Namen sagen, was passiert: `find…`, `list…`, `insert…`, `update…`, `delete…`; `…ForUpdate` sperrt
  die Zeile. Atomare Bedingungen tragen einen fachlichen Namen und melden, ob sie gegriffen haben,
  z. B. `reserveSpacecraft(tx, id, amount): Promise<boolean>`.
- Keine Spielregeln: keine `AppError`-Meldungen, keine Werte aus `game-config`. Prüfen und Melden
  bleibt im Service.
- Repositories importieren nur `lib/db`, `@orions-frontier/shared` und Repositories des eigenen
  Moduls, keine Services.
- Wert-Konstanten aus dem Schema, die Services brauchen (z. B. `goalTypes`), reicht das passende
  Repository weiter; Services importieren das Schema nur als Typ.

## Schichten

| Schicht | Ordner                                        | Inhalt                                                                                                       |
| ------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 0       | `lib/`                                        | DB und Schema, Ausführungskontext, Realtime, Reise, Weltkonfiguration und -generierung, Abschluss-Ereignisse |
| 1       | `auth`, `research`, `map`, `logbook`, `fleet` | Konten; Forschungsstufen und Effekte; Sektoren, Asteroiden, Sicht-Geometrie; Logbuch; Reisen                 |
| 2       | `station`                                     | Station, Ressourcen, Gebäude, Verteidigung, Raumschiffe, Warteschlangen inkl. Forschung, Scanner-Abdeckung   |
| 3       | `missions`                                    | Weltmissionen (Expedition, Kolonie)                                                                          |
| 4       | `world`, `mining`, `combat`, `ranking`        | Karten- und Asteroidenansicht; Abbau-Aufträge, Ladung, Vorschau; Kampf, Bergung, Vernichtung; Rangliste      |
| 5       | `transport`                                   | Reisen der Spieler, Ankünfte abrechnen und an Abbau oder Kampf weitergeben                                   |
| 6       | `bot`                                         | Bot-Entscheidungen; nutzen dieselben Services wie Spieler                                                    |
| 7       | `simulation`                                  | Takt: fällige Arbeit in fester Reihenfolge abarbeiten                                                        |

Neuer Ordner: in `LAYERS` in `.dependency-cruiser.cjs` und in diese Tabelle eintragen.
