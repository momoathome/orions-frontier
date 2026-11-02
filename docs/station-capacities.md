# Stationskapazitäten

## Lager

Die `storage_capacity` des Warehouse gilt separat für jede Ressource einer Station. Mining-,
Bergungs- und Beuterückkehr lagern höchstens den noch freien Platz ein. Überschüssige Fracht
verfällt und zählt nicht zur angezeigten Lieferrate.

Ein laufendes Warehouse-Upgrade erhöht die Kapazität erst bei seiner Fertigstellung. Bereits
vorhandene Bestände oberhalb des Limits bleiben erhalten, erhalten aber keinen weiteren Zugang,
bis Ausgaben wieder Platz schaffen.

Die Kapazität wächst exponentiell wie die Upgrade-Kosten: `5000 × 1,3^(Stufe − 1)`, auf 100
gerundet (Stufe 1: 5.000, Stufe 5: 14.300, Stufe 10: 53.000, Stufe 20: 731.000). Daraus folgen
zwei Regeln:

- Das nächste Upgrade jedes Gebäudes auf derselben Stufe passt immer ins Lager. Kern Stufe 20
  braucht 332.530 Carbon, das Warehouse auf Stufe 19 fasst 562.300. Ein Unit-Test sichert das ab.
- Eine Station, deren Warehouse auf Höhe von Kern und Hangar ausgebaut ist, kann über Nacht weg
  sein. Mit drei Start-Moles auf zwei Ressourcen (je etwa 570/h) reicht Stufe 1 knapp 9 Stunden.
  Wer das Warehouse hinter der Flotte zurücklässt, muss öfter reinschauen.

`protected_storage` bleibt bei `Stufe × 100` und ist bewusst klein: Ein volles Lager ist ein
lohnendes Raid-Ziel.

## Hangar und Crew

Die `hangar_capacity` bezeichnet Crewplätze: `⌊(10 + 10 × Stufe + (Stufe − 1)²) × 1,25⌋` (Stufe 1:
25, Stufe 5: 95, Stufe 10: 238, Stufe 20: 713). Jedes Schiff belegt die in seiner Definition
angegebene Crewzahl. Zur Belegung zählen alle vorhandenen Schiffe einschließlich reisender und
gesperrter Schiffe sowie alle Schiffe in der Bauqueue.

Der Bau reserviert die benötigte Kapazität atomar beim Einstellen des Auftrags. Seine Fertigstellung
verschiebt nur die bereits reservierte Belegung von der Queue in die Flotte. Zerstörte Schiffe geben
ihre Crewplätze unmittelbar frei. Crew ist kein gespeicherter oder verbrauchbarer Ressourcenbestand.
