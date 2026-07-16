# Umsetzungsplan

Dieser Plan beschreibt den Übergang vom bestehenden Orion's Frontier zum autonomen
Idle-Browsergame. Er ist bewusst grob: Konkrete Aufgaben entstehen jeweils erst für die nächste
Phase.

## Leitentscheidung

Die Siedlung handelt selbstständig. Der Spieler setzt Prioritäten oder forciert eine Entscheidung
und trägt deren Konsequenzen. Neue Arbeit muss diesen spielbaren Kern stärken; bestehende Technik
wird erst entfernt, wenn ihre Verantwortung ersetzt ist.

- Der WebSocket bleibt als Spielfunktion erhalten, läuft künftig aber direkt in der API.
- BullMQ wird nicht vorschnell gelöscht. Zuerst wird die Simulation vom Scheduler entkoppelt.
- PostgreSQL bleibt die Quelle der Wahrheit. Ein Timer weckt die Simulation nur auf; er bestimmt
  weder Zeit noch Zustand der Welt.
- Der Umbau erfolgt in kleinen, jederzeit lauffähigen Schritten statt als vollständiger Rewrite.

## Phasen

### 1. Ausgangszustand absichern

Status: abgeschlossen am 16. Juli 2026.

- Docker-Start, Build und Typecheck als verlässliche Basis prüfen.
- Minimale Verhaltenschecks für einmalige Ereignisverarbeitung, Aufholen nach einem Neustart und
  WebSocket-Authentifizierung ergänzen.

Der bestehende Stand wird mit `npm run verify` vollständig und mit `npm run test:behavior` gezielt
gegen PostgreSQL geprüft.

### 2. Autonomen Spielkern bauen

- Einen vollständigen vertikalen Schnitt umsetzen: Die Siedlung erkennt Bedürfnisse, entscheidet
  autonom und berücksichtigt eine Spielerpriorität.
- Forcierte Entscheidungen ohne Schutzmechanismus ausführen; negative Konsequenzen gehören zum
  Spiel.
- Bewegung, Arbeit und Ressourcenfluss auf der Karte sichtbar machen.

Abgeschlossen, wenn dieser Ablauf im Browser spielbar und beobachtbar ist.

### 3. Ersetzte Altmechaniken entfernen

- Klassische Gebäude-, Flotten- und Bauwarteschlangen-Progression entfernen.
- Manuelle Mining-Zuweisung, Rückruf und Logistikverwaltung durch autonome Arbeitsabläufe ersetzen.
- Nicht mehr benötigte Komponenten, Routen, Services, Tabellen, Definitionen und Assets löschen.
- Wiederverwendbare Welt-, Kamera-, Routen- und Trip-Darstellung behalten.

Abgeschlossen, wenn der neue Spielablauf keine alte OGame-Progression mehr benötigt.

### 4. WebSocket in die API integrieren

- Bestehendes Nachrichtenprotokoll und Frontend-Client weiterverwenden.
- Den `WebSocketServer` an Fastifys HTTP-Server hängen.
- Redis-Publishing durch lokale Ereignisverteilung ersetzen.
- Anschließend WebSocket-Workspace und separaten Compose-Service entfernen.

Abgeschlossen, wenn Live-Updates ohne separaten Prozess funktionieren.

### 5. Simulation von BullMQ entkoppeln

- Eine zentrale Simulationsfunktion einführen, beispielsweise `runSimulationStep(now)`.
- Fachlogik aus Workern und Queues in diese Funktion beziehungsweise ihre Domain-Services
  verschieben.
- BullMQ vorübergehend nur noch als Auslöser verwenden.
- Fällige Vorgänge transaktional und wiederholbar verarbeiten.

Abgeschlossen, wenn ein anderer Scheduler dieselbe Simulation ohne Änderung der Fachlogik
auslösen kann.

### 6. Scheduler bewusst entscheiden

- Einen einfachen API-internen Takt mit datenbankgestützten Fälligkeitszeitpunkten erproben.
- Beim Start versäumte Schritte aus PostgreSQL nachholen.
- BullMQ und Redis erst entfernen, wenn die Verhaltenschecks mit dem einfachen Scheduler bestehen.

BullMQ oder eine vergleichbare Queue bleibt beziehungsweise kommt erst zurück, wenn Messungen oder
Betriebsanforderungen mindestens einen dieser Fälle zeigen:

- mehrere Simulationsprozesse müssen parallel arbeiten;
- externe Vorgänge benötigen Wiederholungen oder Dead-Letter-Queues;
- das Laden fälliger DB-Ereignisse wird zum nachgewiesenen Engpass;
- Simulation und API müssen unabhängig betrieben oder skaliert werden.

### 7. Anwendung vereinfachen

- Nach dem Login direkt zur Weltkarte wechseln und das Infrastruktur-Dashboard entfernen.
- Dateibasiertes Route-Autoloading und den `defineRoute`-Wrapper durch wenige explizite
  Feature-Router ersetzen.
- Startup-Seeding und Reset-Skripte auf Migration, explizites Dev-Seed und Docker-Reset reduzieren.
- `game-config` auflösen, sobald die alten Kataloge verschwunden sind; verbleibende gemeinsame
  Werte nach `shared` verschieben.
- Axios durch `fetch`, Pinia durch Vue-Composables und `@fastify/env` durch die vorhandene
  Zod-Validierung plus Node-Umgebungsdatei ersetzen.
- Doppelte Workspace-Abhängigkeiten und ungenutzte Konfiguration entfernen.

Abgeschlossen, wenn die Projektstruktur nur noch den neuen Spielablauf widerspiegelt.

### 8. Abschluss

- Docker Compose, README und Workspace-Beschreibung an den tatsächlichen Stand anpassen.
- Build, Typecheck, Verhaltenschecks und HMR vollständig über den dokumentierten Entwicklungsweg
  prüfen.

Abgeschlossen, wenn das Projekt mit einem dokumentierten Befehl startet und alle Checks bestehen.

## Arbeitsweise

Es wird immer nur die nächste Phase in konkrete Aufgaben zerlegt. Jede Phase muss einen
funktionierenden Projektstand hinterlassen. Löschungen erfolgen erst nach einem nachweisbaren
Ersatz; neue Abstraktionen entstehen erst, wenn ein zweiter realer Anwendungsfall sie verlangt.
