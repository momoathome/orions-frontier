# Services

Spielregeln der API. Routen, `src/index.ts`, `src/seed.ts` und `src/tools/` rufen sie auf; darunter
liegen `src/repositories/` (Datenbank-Abfragen) und `lib/` (Basis). `npm run check:boundaries` (dependency-cruiser,
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
- Services fragen die Datenbank nur über `src/repositories/` ab. `drizzle-orm` und `lib/db/schema`
  importieren sie höchstens als Typ (`import type`); `getDb()`, `Tx` und `QueryDb` aus `lib/db` für
  Transaktionen bleiben erlaubt.
- Tests dürfen Interna direkt importieren.

## Repositories

Eine Datei pro Schema-Datei in `lib/db/schema` (`stations.ts`, `debris-fields.ts`, …); Kind-Tabellen
wie `salvageMissions` gehören zur Datei ihrer Eltern-Tabelle. Eine Abfrage mit Join liegt im
Repository der Tabelle, deren Zeilen sie liefert.

- Einfache Funktionen, erster Parameter `db: QueryDb` (lesen, innerhalb oder außerhalb einer
  Transaktion) oder `tx: Tx` (schreiben, sperren). Der Service öffnet die Transaktion.
- Namen sagen, was passiert: `find…`, `list…`, `insert…`, `update…`, `delete…`; `…ForUpdate` sperrt
  die Zeile. Atomare Bedingungen tragen einen fachlichen Namen und melden, ob sie gegriffen haben,
  z. B. `reserveSpacecraft(tx, id, amount): Promise<boolean>`.
- Keine Spielregeln: keine `AppError`-Meldungen, keine Werte aus `game-config`. Prüfen und Melden
  bleibt im Service.
- Repositories importieren nur `lib/db` und `@orions-frontier/shared`, keine Services.

## Schichten

| Schicht | Ordner                                          | Inhalt                                                                                                       |
| ------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 0       | `lib/`                                          | DB und Schema, Ausführungskontext, Realtime, Reise, Weltkonfiguration und -generierung, Abschluss-Ereignisse |
| 0       | `repositories/`                                 | Datenbank-Abfragen, eine Datei pro Schema-Datei; über `lib/`, unter allen Services                           |
| 1       | `auth`, `research`, `map`, `logbook`, `ranking` | Konten; Forschung und ihre Effekte; Sektoren, Scanner-Sicht, Asteroiden; Logbuch; Rangliste                  |
| 2       | `station`                                       | Station gründen und besitzen, Ressourcen, Gebäude, Verteidigung, Raumschiffe, Stationsbild                   |
| 3       | `world`, `mining`, `combat`, `missions`         | Kartenansicht; Abbau-Aufträge, Ladung, Vorschau; Kampf, Bergung, Vernichtung; Weltmissionen                  |
| 4       | `transport`                                     | Reisen der Spieler, Ankünfte abrechnen und an Abbau oder Kampf weitergeben                                   |
| 5       | `bot`                                           | Bot-Entscheidungen; nutzen dieselben Services wie Spieler                                                    |
| 6       | `simulation`                                    | Takt: fällige Arbeit in fester Reihenfolge abarbeiten                                                        |

Neuer Ordner: in `LAYERS` in `.dependency-cruiser.cjs` und in diese Tabelle eintragen.
