# Frontend

Vue 3 ohne Pinia: Stores sind modulweite `reactive()`-Objekte (`useXStore()`). `main.ts`, `App.vue`
und `router/` starten die App; darunter liegen `features/` (fachliche Einheiten) und `shared/`
(Basis). `npm run check:boundaries` (dependency-cruiser, `.dependency-cruiser.frontend.cjs`) prüft
die Regeln hier.

## Regeln

- Ein Ordner in `features/` ist eine fachliche Einheit, benannt wie das API-Modul. Von außen nur über
  seine `index.ts` importieren; sie exportiert genau das, was andere Features, der Router oder die
  App brauchen. Innerhalb des Features direkt importieren, nie die eigene `index.ts`.
- Keine Zyklen, auch nicht über `index.ts` oder reine Typ-Importe. Abhängigkeiten zeigen wie in der
  API nach unten: `research` kennt `station` nicht, `station` liest Forschungs-Modifikatoren aus
  `research`. Braucht eine untere Einheit Daten von oben, kommen sie als Prop (z. B. Stationen für
  `ResearchDetail`).
- `shared/` importiert kein Feature und nicht die App.
- Ein Store gehört dem Feature, dessen Daten er hält.

## Features

| Ordner     | Inhalt                                                                                 |
| ---------- | -------------------------------------------------------------------------------------- |
| `auth`     | Konto, Sitzung, Login- und Registrierungsseite                                         |
| `research` | Forschungsstand, Modifikatoren, Forschungsbaum, Anforderungs-Chips                     |
| `logbook`  | Logbuch, ungelesene Einträge                                                           |
| `ranking`  | Rangliste                                                                              |
| `station`  | Stationsliste und -details, Gebäude, Bau-Slots und Warteschlange, Bauregeln, Gründung  |
| `fleet`    | Raumschiffe, Werft                                                                     |
| `mining`   | Asteroid-Panel, Miner zuweisen und abziehen, Logistik                                  |
| `combat`   | Kampfberichte, Angriffsziel, Verteidigung der Station                                  |
| `missions` | Grenzgebiet: Expeditionen, Kolonien, Bergung von Trümmerfeldern                        |
| `overview` | Lagebild über alle Features: Reisen, Warnungen, laufende Vorgänge, HUD, Stations-Panel |
| `map`      | Kartenseite (`MapView`) und Pixi-Renderer (`world/`); setzt alle Features zusammen     |

`overview` hält den Sync des Spielbildschirms: `start()` lädt Stationen, Reisen, Kämpfe, Logbuch und
Rangliste und lädt nach Ticks, Abschlüssen und Reconnects nach. `station` hört selbst nur auf
Ereignisse, die eine Station betreffen.

## Shared

- `shared/api/`: HTTP- und WebSocket-Client.
- `shared/lib/`: Formatierung, Debounce, Ressourcen-Namen und -Farben, `live` (Uhr und
  Online-Status).
- `shared/ui/`: fachfreie Bausteine (`UiModal`, `PanelShell`, `CostList`, `QueueList`, …).

## Neuer Code

Gehört er zu einem Feature, kommt er dorthin; braucht ein anderes Feature ihn, in dessen `index.ts`
aufnehmen. Nur was kein Feature kennt, gehört nach `shared/`. Neues Feature: Ordner mit `index.ts`
anlegen und in diese Tabelle eintragen.
