# Stationskapazitäten

## Lager

Die `storage_capacity` des Warehouse gilt separat für jede Ressource einer Station. Mining-,
Bergungs- und Beuterückkehr lagern höchstens den noch freien Platz ein. Überschüssige Fracht
verfällt und zählt nicht zur angezeigten Lieferrate.

Ein laufendes Warehouse-Upgrade erhöht die Kapazität erst bei seiner Fertigstellung. Bereits
vorhandene Bestände oberhalb des Limits bleiben erhalten, erhalten aber keinen weiteren Zugang,
bis Ausgaben wieder Platz schaffen.

## Hangar und Crew

Die `hangar_capacity` bezeichnet Crewplätze. Jedes Schiff belegt die in seiner Definition
angegebene Crewzahl. Zur Belegung zählen alle vorhandenen Schiffe einschließlich reisender und
gesperrter Schiffe sowie alle Schiffe in der Bauqueue.

Der Bau reserviert die benötigte Kapazität atomar beim Einstellen des Auftrags. Seine Fertigstellung
verschiebt nur die bereits reservierte Belegung von der Queue in die Flotte. Zerstörte Schiffe geben
ihre Crewplätze unmittelbar frei. Crew ist kein gespeicherter oder verbrauchbarer Ressourcenbestand.
