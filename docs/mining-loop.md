# Endlicher Mining-Rundlauf

Status: Backend-Kern, Recall, Entscheidungs-UI und sichtbare Mining-Phasen umgesetzt.

Implementierungsstand: Der Backend-Rundlauf von der Zuweisung über Hinflug, ankunftsbasierte
Beanspruchung, Abbauzeit, Rückflug und Lieferung wiederholt sich bereits bis zur vollständigen
Erschöpfung. Der alte periodische Mining-Tick, die Pufferbefüllung, automatische Selbst-Recalls und
die Transporter-Disposition wurden aus dem Laufzeitpfad entfernt. Die allgemeine verzögerte
Trip-Verarbeitung bleibt für die neuen Hin- und Rückflüge bestehen. Die zugehörigen alten
Datenbankfelder und die funktionslosen Transporterschiffe wurden ebenfalls entfernt.

Dieses Dokument ersetzt den Entwurf eines „Autonomous Core“. Die Station wählt weder Ressourcen
noch Asteroiden und baut nicht selbstständig Module oder Einheiten. Automatisiert wird nur die
wiederkehrende Ausführung eines vom Spieler eingerichteten Mining-Auftrags.

## Spielerischer Kern

1. Der Spieler entdeckt einen Asteroiden.
2. Er beurteilt Entfernung, Vorrat und die Leistung seiner verfügbaren Miner.
3. Er weist dem Asteroiden einen oder mehrere Miner zu.
4. Die Miner fliegen hin, bauen ab, kehren mit ihrer Ladung zurück und liefern sie ab.
5. Der Auftrag wiederholt sich, bis der Spieler ihn ändert oder der Asteroid erschöpft ist.
6. Der Spieler investiert die gelieferten Ressourcen in Stationsmodule und Einheiten.

Das Idle-Spiel übernimmt damit Wiederholung und Offline-Fortschritt, aber nicht die
wirtschaftlichen Entscheidungen des Spielers.

## Festgelegte Entscheidungen

### Endliche Asteroiden

- Jede Ressourcenader besitzt eine konkrete verbleibende Menge.
- Förderung reduziert diese Menge tatsächlich.
- Asteroiden besitzen keine zusätzliche Förderkapazität. Zehn Miner dürfen annähernd zehnmal so
  schnell abbauen wie ein Miner.
- Es gibt keinen geschützten Restvorrat und keine automatische wirtschaftliche Abschaltung.
- Nach vollständiger Erschöpfung endet der Auftrag; Miner kehren mit ihrer letzten, gegebenenfalls
  unvollständigen Ladung zurück.
- Restmenge und erwartete Erschöpfungszeit sind vor und während des Auftrags sichtbar.

Eine schnelle Erschöpfung durch viele Miner ist eine bewusste Spielerentscheidung. Die
Vorratsgrößen müssen verhindern, dass ein normal belegter früher Asteroid unbeabsichtigt in einer
kurzen Offline-Phase verschwindet.

### Einfaches Asteroidenmodell

Eine Ressourcenader benötigt im Zielmodell nur:

```text
resourceKey       carbon
remainingAmount  10000
```

`yieldPerHour` wird durch `remainingAmount` ersetzt. `stability`, `purity` und `purityTier`
entfallen ebenfalls:

- die Abbaugeschwindigkeit kommt ausschließlich vom Miner;
- die Entfernung beeinflusst ausschließlich Flugzeit und Lieferleistung;
- die Asteroidengröße bestimmt bei der Weltgenerierung den möglichen Vorratsbereich;
- die Ressourcenverteilung der Welt bestimmt, wie häufig Carbon, Titanium und seltene Ressourcen
  gefunden werden.

Ein Asteroid darf weiterhin mehrere Ressourcenadern besitzen. Sein Gesamtvorrat wird anhand seiner
Größe erzeugt und auf die vorhandenen Adern verteilt. Dafür kann die bestehende Gewichtung aus
Primär-, Sekundär- und Spurader zunächst weiterverwendet werden; sie ist dann nur noch eine
Verteilungsregel und kein Förderlimit.

Beispielhafte, noch nicht balancierte Vorratsbereiche:

| Größe  |    Gesamtvorrat |
| ------ | --------------: |
| klein  |    8.000–12.000 |
| mittel |   20.000–30.000 |
| groß   |   50.000–80.000 |
| massiv | 120.000–200.000 |

Die Werte sind Startwerte für den spielbaren Durchstich, keine endgültige Balance. Ressourcen
werden als ganze Einheiten gespeichert. Ein Asteroid gilt ohne zusätzliches Statusfeld als
erschöpft, sobald alle seine Adern `remainingAmount = 0` besitzen. Er bleibt nur so lange in der Welt,
bis alle bereits aktiven Minergruppen ihre beanspruchte Ladung abgeliefert haben. Mit der Rückkehr
der letzten Gruppe werden Asteroid und Adern entfernt.

Die Vorratsbereiche werden später aus einer gewünschten Laufzeit abgeleitet:

```text
Zielvorrat = Referenz-Lieferleistung × gewünschte Laufzeit
```

Ein Vorrat von `10.000` Einheiten hält bei einer Lieferleistung von `66,7/h` ungefähr 150 Stunden
beziehungsweise gut sechs Tage. Zwei gleiche Miner verkürzen diese Dauer näherungsweise auf drei
Tage. So bleiben die Vorratswerte nachvollziehbar, obwohl sie anschließend anhand des
Spielgefühls angepasst werden.

Bei konkurrierenden Minern wird die tatsächlich entnommene Menge innerhalb einer
Datenbanktransaktion auf den aktuellen Restvorrat begrenzt. Dadurch kann die letzte Ladung kleiner
als der Frachtraum sein, aber der Vorrat niemals negativ werden.

### Ein Miner übernimmt den Rundlauf

Für den ersten spielbaren Schnitt gibt es keinen separaten Transporterbetrieb:

1. Der Miner fliegt leer zum Asteroiden.
2. Er baut, bis sein Frachtraum voll oder der Asteroid erschöpft ist.
3. Er fliegt zur Station zurück und liefert seine Ladung ab.
4. Bei bestehendem Auftrag und verbleibendem Vorrat beginnt der nächste Rundlauf.

Fordert der Spieler einen Recall an, wird eine bereits beanspruchte Ladung noch geliefert. Die
vollständige gemeinsam fliegende Minergruppe wird erst bei ihrer nächsten Ankunft an der Station
freigegeben und beginnt keinen weiteren Rundlauf. Trifft die Recall-Anforderung noch vor der
Beanspruchung am Asteroiden ein, kehrt die Gruppe ohne neue Ladung zurück. Ein Teil-Recall innerhalb
einer fliegenden Gruppe ist zunächst nicht vorgesehen.

Asteroidenpuffer, automatische Transport-Disposition, Förderkapazität und
Stabilitätsverschleiß entfallen mit der Umstellung. Spezialisierte Logistik kommt nur zurück, wenn
ein späterer spielbarer Bedarf wie Außenposten oder große Mining-Netze sie rechtfertigt.

### Konkurrenz um den letzten Vorrat

Beim Versenden wird noch keine Ressource reserviert. Erst wenn eine Minergruppe tatsächlich am
Asteroiden ankommt, beansprucht sie innerhalb einer Datenbanktransaktion höchstens ihren
gemeinsamen Frachtraum. Mehrere Miner derselben Gruppe teilen eine unvollständige Ladung und bauen
sie mit ihrer gemeinsamen Rate ab.

Bereits beanspruchte Ressourcen zählen als „im Abbau“ und stehen später eintreffenden Gruppen nicht
mehr zur Verfügung. Reicht der freie Vorrat nicht, erhält die Gruppe eine Teilladung und benötigt
entsprechend weniger Abbauzeit. Ist nichts mehr frei, endet ihr Auftrag und sie kehrt leer zurück.
Bei konkurrierenden Spielern entscheidet damit die tatsächliche Ankunftszeit und nicht der
Zeitpunkt des Versendens. Gleichzeitig verarbeitete Ankünfte werden durch die Transaktion eindeutig
nacheinander vergeben.

### Verantwortung des Spielers

Der Spieler entscheidet:

- welcher Asteroid erschlossen wird;
- wie viele Miner dort arbeiten;
- welches Stationsmodul gebaut wird;
- welche Einheit gebaut wird;
- welche Expedition oder welcher Angriff gestartet wird.

Automatisch sind nur Flug, Abbau, Rückkehr und Lieferung eines bereits erteilten Auftrags.

### Weltraumperspektive

Miner und andere Einheiten bleiben sichtbare Schiffe beziehungsweise Punkte. Eine Umstellung auf
Bewohnergruppen ist nicht vorgesehen.

## Zeit- und Leistungsmodell

Die Abbaurate beschreibt die Leistung während der Arbeit am Asteroiden. Die Reisezeit reduziert
die tatsächlich an der Station ankommende Leistung.

```text
Abbauzeit       = Ladungsmenge / Abbaurate
Flugzeit        = Entfernung / Geschwindigkeit
Rundlaufzeit    = Abbauzeit + 2 × Flugzeit
Lieferleistung  = Ladungsmenge / Rundlaufzeit
```

Für einen Miner mit `120/h` Abbaurate und `100` Einheiten Frachtraum beträgt die reine Abbauzeit
50 Minuten:

- 5 Minuten Flug pro Strecke: 60 Minuten Rundlauf, `100/h` Lieferleistung;
- 20 Minuten Flug pro Strecke: 90 Minuten Rundlauf, ungefähr `66,7/h` Lieferleistung;
- 40 Minuten Flug pro Strecke: 130 Minuten Rundlauf, ungefähr `46,2/h` Lieferleistung.

Bei der letzten Teilmenge wird mit der tatsächlichen Ladungsmenge gerechnet. Für mehrere gleiche
Miner kann die Vorschau näherungsweise linear rechnen, solange genügend Vorrat verbleibt:

```text
Gemeinsame Lieferleistung = Anzahl Miner × Lieferleistung eines Miners
```

Die Simulation selbst muss konkurrierende Abbauvorgänge transaktional begrenzen, damit der
Asteroid nie unter null fällt und seine letzte Ressource nur einmal vergeben wird.

## Darstellung und Entscheidungshilfe

Vor einer Zuweisung zeigt die Oberfläche:

- Entfernung zum Asteroiden;
- Ressourcenarten und verbleibende Mengen;
- Geschwindigkeit, Abbaurate und Frachtraum des Miners;
- Flugzeit pro Strecke und erwartete Rundlaufzeit;
- Lieferleistung eines Miners und aller vorgesehenen Miner zusammen;
- erwartete vollständige Erschöpfung des Asteroiden.

Während des Auftrags zeigt die Welt die Miner in den Phasen Hinflug, Abbau und Rückflug. Angezeigte
Zeiten und Raten sind Prognosen aus demselben Berechnungsmodell, das die Simulation verwendet.

## Sinn der Schiffswerte

- Eine höhere Abbaurate verkürzt die Arbeitsphase.
- Eine höhere Geschwindigkeit ist besonders auf langen Strecken wertvoll.
- Ein größerer Frachtraum verteilt die Reisezeit auf mehr gelieferte Ressourcen.
- Ein leistungsfähigerer Miner erzielt mehr Lieferleistung pro später belegtem Hangarplatz.

Damit sind Entfernung und Schiffswahl echte wirtschaftliche Entscheidungen, ohne eine zusätzliche
Transportökonomie zu benötigen.

## Bewusst nachgelagert

### Hangarplätze

Hangarplätze bleiben als gemeinsame Grenze für zivile und militärische Schiffe vorgesehen. Sie
werden erst nach dem funktionierenden Mining-Rundlauf eingeführt. Ein Schiff belegt seinen Platz
auch während eines Auftrags, damit abwesende Schiffe keinen unbegrenzten Neubau erlauben.

### Hydrogenium

`hydrogenium` bleibt als Energieversorgung der Station vorgesehen. Ob Mining-Aufträge oder
Entfernung zusätzlich Hydrogenium verbrauchen, wird erst nach einem spielbaren Rundlauf bewertet.
Der erste Schnitt erhält keine weitere Verbrauchsregel nur um ihrer selbst willen.

### Logistik

Separate Frachter und lokale Ressourcenpuffer sind kein Teil des ersten Kerns. Sie werden nicht als
bereits geplantes Ausbaulevel vorgebaut.

## Noch festzulegen

Diese Werte und Darstellungsfragen werden anhand des ersten spielbaren Rundlaufs entschieden:

1. Wie lange hält ein kleiner früher Asteroid bei einem üblichen Miner ungefähr?
2. Welche Miner und Schiffswerte besitzt eine neue Station zu Beginn?
3. Wann werden Hangarplätze erstmals spielerisch notwendig?

Sie blockieren die technische Vorbereitung nicht. Für den ersten Durchstich genügen klar
gekennzeichnete Startwerte, die anschließend anhand des Spielgefühls geändert werden.
