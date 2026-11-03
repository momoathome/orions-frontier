# Spec: Bomber, Vernichtung und Mehrstationen-Pfad

Status: umgesetzt, Werte im Playtest. Nach dem Playtest geht diese Spec in einen kurzen
Systemvertrag auf; die Spec selbst wird gelöscht.

Grundlage: [Design-Kompass](./design-compass.md), Abschnitt „Entscheidungen“.

## Ziel

Stationen können vernichtet werden. Damit wird PvP zum Kern, und eine zweite Station wird zur
Überlebensstrategie. Der Spielerablauf:

1. Ein Angreifer schlägt die Verteidigung mit Jägern und bringt Bomber durch.
2. Überlebende Bomber senken die Integrität der Station. Eine Welle reicht nie.
3. Der Verteidiger sieht den Angriff kommen und kann reagieren: Flotte bauen, Defense ausbauen,
   Lager leeren oder zurückschlagen.
4. Bei Integrität 0 ist die Station vernichtet. Ein Trümmerfeld bleibt.
5. Wer seine letzte Station verliert, startet neu mit einer Starterstation.

## Nicht Teil dieser Spec

- Stationsübernahme (bleibt ausgeschlossen);
- Allianzen, gemeinsame Angriffe mehrerer Spieler, Unterstützungsflotten bei Verbündeten;
- Reparatur gegen Ressourcen, Schilde oder andere neue Defense-Systeme;
- Logistik zwischen eigenen Stationen.

## 1. Bomber

Neue Schiffsrolle `bomber`. Ein Schiff zum Start:

| Wert       | Startwert                                            |
| ---------- | ---------------------------------------------------- |
| Key, Name  | `hammer`, Hammer                                     |
| Rolle      | `bomber`                                             |
| Angriff    | 10                                                   |
| Verteidig. | 60                                                   |
| Fracht     | 0                                                    |
| Tempo      | 50 (langsamstes Kampfschiff)                         |
| Crew       | 12                                                   |
| Bauzeit    | 600                                                  |
| Kosten     | 800 Carbon, 900 Titanium, 500 Hydrogenium, 150 Kyber |
| Freischalt | Shipyard 7, Weapons 4, Armor 5                       |

- Bomber kämpfen kaum. Sie wirken nur über die Integrität.
- Durch ihr Tempo bestimmen sie die Ankunftszeit einer gemischten Flotte. Das ist für den
  Verteidiger ein lesbares Signal.
- Bomber dürfen nicht zu Asteroiden fliegen und keine Bergung ausführen.
- Die Werte sind Startwerte für den Playtest, nicht festgeschrieben.

## 2. Gemischte Angriffsflotten

Heute schickt ein Angriff genau einen Schiffstyp (`spacecraftKey`, `amount`). Bomber brauchen
Begleitschutz, deshalb wird der Angriff auf eine Zusammensetzung umgestellt:

```text
POST attack  { stationId, targetStationId, fleet: { merlin: 40, hammer: 4 } }
```

- Erlaubt sind die Rollen `fighter` und `bomber`. Alle Gruppen werden in einer Transaktion
  gesperrt; die Flotte reist gemeinsam mit dem Tempo des langsamsten Schiffs.
- Speicherung: `combat_missions` erhält statt `attacker_station_spacecraft_id` und
  `attacker_amount` eine Spalte `attacker_fleet jsonb` (`{ key: amount }`). Die Hin- und
  Rückreise bleibt eine einzige `spacecraft_trip`. Deren `station_spacecraft_id` zeigt auf die
  langsamste Gruppe, `group_size` ist die Gesamtzahl.
- Angriffskraft = Summe(Anzahl × effektiver Angriff) aller Gruppen. Verteidigungskraft =
  Stationsverteidigung + angedockte Schiffe × Verteidigung, jeweils mit Forschung. Die
  Verteidigung eines Schiffs zählt nur zu Hause.
- Die stärkere Seite gewinnt, bei Gleichstand der Verteidiger. Der Verlierer verliert alle
  beteiligten Schiffe (beim Verteidiger die angedockten). Der Sieger verliert je Gruppe den Anteil
  `(Verlierer-Kraft / Sieger-Kraft)^1,5`, abgerundet: bei doppelter Übermacht etwa 35 %, bei
  vierfacher etwa 12 %. Die Stationsverteidigung wird nie zerstört.
- Beute: 30 % jeder ungeschützten Ressource, bis der Frachtraum der Überlebenden voll ist.
  Trümmer bleiben wie bisher.
- Bots verwenden dieselbe Route und denselben Service.

## 3. Integrität

- Neue Spalten in `stations`: `integrity integer not null default 100` und
  `integrity_updated_at timestamptz not null`.
- **Regeneration** wird beim Lesen berechnet, nicht per Tick:
  `aktuell = min(100, gespeichert + floor((jetzt − integrity_updated_at) / 1 h))`.
  Jede Änderung schreibt den aktuellen Wert und setzt `integrity_updated_at = jetzt`.
- **Schaden** entsteht nur, wenn der Angreifer den Kampf gewinnt und mindestens ein Bomber
  überlebt:

  ```text
  Wellenschaden = min(35, 15 + 5 × überlebende Bomber)
  ```

  Ein Bomber macht 20 Schaden, ab vier Bombern ist die Welle bei 35 gedeckelt. Eine Vernichtung
  braucht also mindestens drei erfolgreiche Wellen in kurzem Abstand.

- Der Kompass schlug einen Zufallswert von 20–35 vor. Diese Spec nimmt eine feste Formel, weil
  Regeln deterministisch und erklärbar sein müssen (AGENTS.md). Wer mehr Bomber durchbringt, macht
  mehr Schaden.
- Integrität ist für den Besitzer sichtbar, für andere nur innerhalb der Scannerabdeckung, und dann
  grob in Stufen (100–76, 75–51, 50–26, 25–1).
- Der Kampfbericht nennt den Wellenschaden und die neue Integrität: dem Verteidiger genau, dem
  Angreifer nur nach Schaden und dann in Stufen; ohne Schaden erfährt er sie nicht.

## 4. Vernichtung

Fällt die Integrität auf 0, wird die Station in derselben Transaktion wie der Kampf vernichtet:

1. **Trümmerfeld** an der Stationsposition:
   - der gesamte verbleibende Lagerbestand nach der Beute;
   - 20 % der in Gebäude und Defense investierten Ressourcen (`investedUpgradeCosts`, dieselbe
     Kostenrechnung wie `calculateInfluence`);
   - angedockte Schiffe nach der bestehenden 30-%-Regel (`createDebrisFromLosses`).
2. **Schiffe:** Alle angedockten Schiffe sind verloren. Reisen, die von dieser Station ausgehen
   oder zu ihr zurückkehren, werden abgebrochen. Ihre Schiffe fliegen mit ihrer Fracht von der
   aktuellen Position zur nächsten eigenen Station (Reisezweck `relocate`) und zählen dort bis zur
   Ankunft als unterwegs. Laufende Kampf- und Bergungsmissionen enden ohne Ergebnis;
   Weltmissionen wechseln ihre Heimatstation. Ohne weitere eigene Station sind die Schiffe
   verloren.
3. **Laufende Arbeit:** Bau- und Schiffsaufträge, Mining-Zuweisungen und Weltmissionen der Station
   werden beendet, ohne Erstattung. Forschung gehört dem Account und bleibt erhalten.
4. **Datensätze:** Gebäude, Ressourcen, Bauaufträge und Zuweisungen werden gelöscht,
   Flottenzeilen auf 0 gesetzt (Reisen verweisen weiter darauf). Die Zeile in `stations` bleibt mit `destroyed_at timestamptz` erhalten, damit
   Kampfberichte, Trümmerfelder und Logbuch ihre Referenz behalten.
5. **Spawn-Slot:** Ein belegter Slot wird wieder frei.
6. Alle Stationsabfragen filtern `destroyed_at is null`: Karte, Scannerabdeckung, Rangliste,
   eigene Stationen, Angriffsziele, Bot-Snapshot, Ticks.
7. Beide Spieler erhalten einen Logbucheintrag.

Die Vernichtung läuft genau einmal: Die Kampftransaktion sperrt die Zielstation mit
`for update`. Eine zweite gleichzeitige Welle findet `destroyed_at` gesetzt vor und
endet ohne Kampf; ihre Flotte kehrt um.

## 5. Eingehende Angriffe sichtbar machen

Der Vorteil aktiver Spieler kommt allein vom Reagieren. Dafür muss der Verteidiger den Angriff
früh sehen:

- Beim Start eines Angriffs erhält der Verteidiger sofort einen **eingehenden Angriff**, unabhängig
  von seinem Scanner: angreifende Station, Ziel und Ankunftszeit. Die Zusammensetzung bleibt
  verborgen.
- Sobald die Flotte in seine Scannerabdeckung eintritt, sieht er sie zusätzlich als Radarkontakt
  wie bisher.
- Die Station zeigt eine Liste eingehender Angriffe mit Countdown. Die Karte markiert die Zielstation.
- Realtime-Ereignis an den Verteidiger beim Start, damit kein Reload nötig ist.

Das widerspricht dem Scannervertrag nicht: Der Angriff betrifft eine eigene Station. Er verrät nur
die öffentlich bekannte Position der angreifenden Station.

## 6. Mehrstationen-Pfad

Eine zweite Station ist die Versicherung gegen Vernichtung. Das Zahlenziel aus dem Kompass: die
zweite Station nach 1–2 Tagen für einen gelegentlichen Spieler.

- **Kolonisationskosten steigen mit der Stationszahl:**

  ```text
  Kosten(n) = Basis × 1,5^(n − 1)     n = Anzahl eigener Stationen vor der Gründung
  Basis     = 8.000 Carbon, 8.000 Titanium, 3.000 Hydrogenium
  ```

  Die Basis passt ab Warehouse Stufe 5 (14.300) ins Lager. Sie ersetzt `COLONIZATION_COST`, die
  mit 1.500/1.500/750 nach dem Rebalancing in wenigen Stunden erreichbar ist.

- Die Werte sind Startwerte; der Playtest misst die tatsächliche Zeit bis zur zweiten Station.
- Startpaket und Ablauf der Kolonisation bleiben unverändert.

## 7. Neustart nach der letzten Station

- Ein Spieler ohne Station sieht statt der Karte einen Neustart-Dialog.
- Neustart gründet eine Starterstation wie bei der Registrierung (`seedAdminUser` bzw. der
  Registrierungspfad: Spawn-Slot in einem Ansiedlungssektor, drei Mole, Startgebäude).
- Der Angriffsschutz von 24 Stunden gilt danach erneut. Dafür wird die Schutzprüfung von
  `users.created_at` auf eine neue Spalte `users.protected_until` umgestellt.
- Rangliste und Influence ergeben sich automatisch aus den verbliebenen Werten.

## Umsetzung

Reihenfolge, jeweils mit `npm run verify`:

1. **Gemischte Flotten** (Abschnitt 2) ohne Bomber: Schema, Service, Route, Frontend-Formular, Bots.
2. **Bomber und Integrität** (Abschnitte 1, 3): Konfiguration, Spalten, Schaden, Bericht, Anzeige.
3. **Eingehende Angriffe** (Abschnitt 5).
4. **Vernichtung und Neustart** (Abschnitte 4, 7).
5. **Kolonisationskosten** (Abschnitt 6) und Playtest-Messung.

Betroffene Stellen (Auswahl): `combat/combat.ts`, `combat/salvage.ts`,
`missions/world-mission.ts`, `world/world.ts` (Projektion, `MILITARY_TRIP_PURPOSES`),
`map/scanner-visibility.ts`, `ranking/ranking.ts`, `bot/goal-*`, `game-config`
(`spacecrafts.ts`, `buildings.ts`, `resources.ts`), `shared` (Rolle, Berichte, Payloads),
`DefenseTab.vue`, `TargetStationPanel.vue`, `StationPanel.vue`, eine Migration mit Schema-Export.

## Akzeptanzkriterien und Tests

Je ein fokussierter Test:

- Gemischte Flotte: Verluste anteilig, langsamstes Tempo bestimmt die Ankunft, Sperren atomar.
- Bomber ohne Sieg oder ohne Überlebende machen keinen Schaden.
- Wellenschaden folgt der Formel (1, 4 und 10 Bomber).
- Regeneration: +1 pro volle Stunde, nie über 100, ohne Tick.
- Zwei gleichzeitige Wellen auf eine Station mit Integrität 30: genau eine Vernichtung, genau ein
  Trümmerfeld.
- Nach der Vernichtung: Station weder auf der Karte noch als Ziel noch in der Rangliste; Reisen und
  Zuweisungen beendet; Kampfberichte weiterhin lesbar.
- Eingehender Angriff ist für den Verteidiger ohne Scannerabdeckung sichtbar, ohne Zusammensetzung.
- Kolonisationskosten für die zweite und dritte Station.
- Neustart: neue Station, neuer Schutz, kein Neustart solange eine Station existiert.
- Ein Bot führt einen gemischten Angriff über denselben Service aus.

## Entscheidungen

1. **Schiffe unterwegs bei Vernichtung** fliegen zur nächsten eigenen Station (Abschnitt 4).
2. **Integrität für Fremde** ist nur in der Scannerabdeckung sichtbar, in vier Stufen; die API
   liefert die Obergrenze der Stufe (25, 50, 75, 100).
3. **Regeneration** bleibt vorerst bei +1/h.
4. **Hauptstation** bekommt keinen Sonderschutz.

## Offen nach dem ersten Schnitt

- Bots bauen noch keine Bomber; sie nehmen nur vorhandene Bomber in Raids mit.
- Die Karte markiert die Zielstation eines eingehenden Angriffs nicht gesondert; die Liste steht im
  Defense-Tab.
