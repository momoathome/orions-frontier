# Services

Spielregeln und Datenzugriff der API. Routen, `src/index.ts`, `src/seed.ts` und `src/tools/` rufen
sie auf; `lib/` ist die Basis darunter. `npm run check:boundaries` (dependency-cruiser,
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
- Tests dürfen Interna direkt importieren.

## Schichten

| Schicht | Ordner                                          | Inhalt                                                                                                       |
| ------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 0       | `lib/`                                          | DB und Schema, Ausführungskontext, Realtime, Reise, Weltkonfiguration und -generierung, Abschluss-Ereignisse |
| 1       | `auth`, `research`, `map`, `logbook`, `ranking` | Konten; Forschung und ihre Effekte; Sektoren, Scanner-Sicht, Asteroiden; Logbuch; Rangliste                  |
| 2       | `station`                                       | Station gründen und besitzen, Ressourcen, Gebäude, Verteidigung, Raumschiffe, Stationsbild                   |
| 3       | `world`, `mining`, `combat`, `missions`         | Kartenansicht; Abbau-Aufträge, Ladung, Vorschau; Kampf, Bergung, Vernichtung; Weltmissionen                  |
| 4       | `transport`                                     | Reisen der Spieler, Ankünfte abrechnen und an Abbau oder Kampf weitergeben                                   |
| 5       | `bot`                                           | Bot-Entscheidungen; nutzen dieselben Services wie Spieler                                                    |
| 6       | `simulation`                                    | Takt: fällige Arbeit in fester Reihenfolge abarbeiten                                                        |

Neuer Ordner: in `LAYERS` in `.dependency-cruiser.cjs` und in diese Tabelle eintragen.
