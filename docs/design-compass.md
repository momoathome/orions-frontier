# Design-Kompass

Status: Richtungsentscheidung, Grundlage für Balancing und neue Systeme.

## Vision

Die Stämme im All: Spieler breiten sich mit mehreren Stationen aus, beuten Asteroiden aus, halten
Gebiet und vernichten gegnerische Stationen. Die Live-Karte zeigt die Wirtschaft und den Krieg wie
eine Fabrik, der man gern zusieht.

## Drei Säulen

1. **Territorium und Vernichtung (Stämme).** PvP ist Kern. Stationen werden nicht übernommen,
   sondern vernichtet. Wer nur eine Station hat, kann raus sein. Expansion ist Überlebensstrategie.
2. **Der Fabrik zusehen (Factorio, Dyson Sphere Program).** Aufträge laufen automatisch und sichtbar.
   Es gibt immer einen nächsten sinnvollen Schritt.
3. **Jeder Spielstil zählt (Pennergame).** Reinschauen alle 10 Minuten, alle paar Stunden oder einmal
   am Abend muss jeweils funktionieren. Aktive Spieler gewinnen durch Kampf und Entscheidungen, nicht
   durch Klickfleiß.

## Kernloop

Erkunden → Asteroid wählen → Miner zuweisen → Ressourcen fließen → Station ausbauen → neue Station
gründen → Felder und Stationen verteidigen oder angreifen → Rangliste.

Belohnungskette aus Spielersicht: Kampf gewinnen und Gebiet halten → Station wächst → Rang steigt.

## Regeln für Aktionen

Jede Spieleraktion braucht:

- **eine Entscheidung:** mindestens zwei sinnvolle Optionen (nah und sicher gegen fern und reich);
- **ein sichtbares Ergebnis:** auf Karte, Station oder Rangliste;
- **einen spürbaren Ertrag:** eine Lieferung muss relativ zum nächsten Ziel zählen.

Mehr Miner zum selben Ziel zu schicken ist keine Entscheidung, sondern Ausführung.

## Session-Takt

| Spielstil      | Reinschauen   | Womit er vorankommt                                          |
| -------------- | ------------- | ------------------------------------------------------------ |
| Aktiv          | alle 10–30min | Kämpfe, Raids, schnelles Umplanen, kurze Ausbauten           |
| Gelegentlich   | alle 2–4h     | neue Aufträge bei erschöpften Asteroiden, mittlere Ausbauten |
| Abends/Morgens | 1–2× täglich  | Lager reicht über Nacht, lange Ausbauten, Verteidigung steht |

Hebel: Die Lagerkapazität (Warehouse) bestimmt, wie lange man ohne Verlust weg sein kann. Damit wählt
der Spieler seinen Takt selbst, ähnlich wie bei Pennergames Sammeldauer.

## Zahlenziele

Zielwerte, an denen sich das Balancing misst (für die Startphase, per Playtest zu prüfen):

- Ein Rundlauf eines Start-Miners deckt etwa 15–30 % des nächsten Kern-Upgrades.
- Mit der Startflotte ist das erste Kern-Upgrade nach etwa 10–15 Minuten bezahlbar.
- Ein Miner-Rundlauf dauert in der Startphase etwa 15 Minuten, passend zum aktiven Takt.
- Die zweite Station ist für einen gelegentlichen Spieler nach 1–2 Tagen erreichbar.
- Ein kleiner Asteroid trägt einen Start-Miner mindestens eine Nacht, ein großer eine Woche oder
  länger.

Stand: Eine Mole bringt 100 pro Rundlauf von etwa 13–18 Minuten im Startbereich (cargo 100,
miningRate 600/h, 10 Minuten Abbau). Kern Stufe 3 kostet 338 Carbon und 225 Titanium, eine Lieferung
deckt also etwa 18 %. Asteroidenvorräte wurden mit der Förderleistung verdreifacht, damit
Startbereich und Sektor ihre Laufzeit behalten. Vorher: 20 pro Rundlauf von etwa 8 Minuten, also
etwa 5 % eines Upgrades.

Lager: Die Warehouse-Kapazität wächst jetzt mit Faktor 1,3 pro Stufe ab 5.000 statt linear ab 1.500.
Vorher passte ab Stufe 11 das nächste Upgrade nicht mehr ins Lager, ein harter Softlock, und das
Lager war auf jeder Stufe nach etwa 2 Stunden voll. Jetzt reicht es auf Höhe der Flotte
mindestens 7–9 Stunden, auf hohen Stufen deutlich länger (Details in `docs/station-capacities.md`).

## Bewusst noch nicht

- Logistik zwischen eigenen Stationen (DSP-Gefühl), sobald mehrere Stationen Alltag sind.
- Weitere Ressourcen, Gebäude oder Schiffsklassen, bevor der Grundtakt sitzt.

## Entscheidungen

### Vernichtung einer Station

- Jede Station hat eine **Integrität** von 100. Bei 0 ist sie vernichtet.
- Nur ein **Bomber** senkt die Integrität. Er ist teuer und langsam und wirkt nur, wenn er den Kampf
  überlebt. Erst muss also die Verteidigung fallen.
- Ein überlebender Bomber senkt die Integrität um einen Zufallswert (Vorschlag 20–35), also braucht
  es mehrere Wellen.
- Die Integrität regeneriert langsam (Vorschlag +1 pro Stunde). Vernichtung braucht damit
  koordinierte Angriffe in einem Zeitfenster, und der Verteidiger hat Zeit zu reagieren.
- Übrig bleibt ein Trümmerfeld wie nach einem Kampf: Lagerbestand und ein Teil der verbauten
  Ressourcen.

### Asteroiden

- Asteroiden sind vorerst nur Ressourcenquellen, keine Claims.
- Mehrere Spieler können denselben Asteroiden abbauen. Der Wettbewerb ist das gemeinsame Leeren.
- Kampfschiffe fliegen nicht zu Asteroiden. Konflikt findet an Stationen statt.
- „Gebiet halten“ heißt damit: Stationen nah an reichen Feldern platzieren und verteidigen.

### Aktive Spieler

- Kein mechanischer Ertragsbonus fürs Aktivsein.
- Der Vorteil aktiver Spieler kommt allein daher, dass sie reagieren können: eingehende Angriffe
  sehen und verteidigen, Aufträge umplanen, Gegner mit vollem Lager angreifen.
- Dafür müssen eingehende Angriffe rechtzeitig sichtbar sein.

## Nächste Schritte

1. Miner-Werte und Lagerkurve per Playtest gegen die Zahlenziele messen.
2. Vernichtung und Mehrstationen-Pfad als nächste Spielmechanik festlegen.
