# Endlicher Mining-Rundlauf

Der Spieler wählt Asteroid und Minerzahl. Automatisiert ist nur die wiederkehrende Ausführung des
Auftrags: Flug, Abbau, Rückkehr und Lieferung. Ohne Forschung wählt die Station weder Ressourcen noch
Asteroiden und baut nichts selbstständig. Autonomous Rerouting leitet Miner eines erschöpften
Asteroiden zum nächsten mit derselben Ressource um; die Autonomous Mining Fleet weist neu gebaute
und freie Miner selbst zu (`docs/research.md`).

## Ablauf

1. Der Spieler beurteilt Entfernung, Vorrat und die Leistung seiner Miner und weist Miner zu.
2. Die Gruppe startet gemeinsam, fliegt zum Asteroiden und beansprucht bei Ankunft ihre Ladung.
3. Sie baut ab, fliegt zurück und liefert an die Station.
4. Der Auftrag wiederholt sich, bis der Spieler ihn ändert oder der Asteroid erschöpft ist.

Auf der Karte umkreisen die Miner den Asteroiden während des Abbaus langsam und verlassen den Orbit
dort, wo sie angekommen sind.

## Regeln

### Endliche Asteroiden

- Jede Ressourcenader hat nur `resourceKey` und `remainingAmount`. Abbaurate und Geschwindigkeit
  kommen ausschließlich vom Miner, die Entfernung bestimmt nur die Flugzeit.
- Förderung reduziert den Vorrat tatsächlich. Es gibt kein Förderlimit pro Asteroid: zehn Miner
  bauen annähernd zehnmal so schnell ab wie einer.
- Es gibt keinen geschützten Restvorrat und keine automatische Abschaltung. Restmenge und erwartete
  Erschöpfung sind vor und während des Auftrags sichtbar.
- Ein Asteroid ist erschöpft, sobald alle Adern `remainingAmount = 0` haben. Er wird entfernt, wenn
  die letzte aktive Gruppe ihre Ladung abgeliefert hat.

Vorratsbereiche (`apps/api/src/lib/world-config.ts`):

| Größe  |    Gesamtvorrat |
| ------ | --------------: |
| klein  |     2.700–4.800 |
| mittel |   12.000–21.000 |
| groß   |   45.000–84.000 |
| massiv | 240.000–420.000 |

Der Gesamtvorrat wird nach Größe erzeugt und auf Primär-, Sekundär- und Spuradern verteilt.

### Konkurrenz um den letzten Vorrat

Beim Versenden wird nichts reserviert. Erst bei Ankunft beansprucht eine Gruppe in einer
Transaktion höchstens ihren gemeinsamen Frachtraum. Beanspruchte Ressourcen stehen später
eintreffenden Gruppen nicht mehr zur Verfügung. Reicht der freie Vorrat nicht, gibt es eine
Teilladung mit kürzerer Abbauzeit; ist nichts mehr frei, kehrt die Gruppe leer zurück. Es zählt
die Ankunftszeit, nicht der Versandzeitpunkt. Der Vorrat wird nie negativ.

### Recall

Der Spieler kann einzelne Miner einer Gruppe zurückrufen. Sie beenden den aktuellen Rundlauf und
werden bei der nächsten Ankunft an der Station frei; die übrigen starten wieder gemeinsam. Trifft der
Recall vor der Beanspruchung ein, bauen nur die weiterhin aktiven Miner ab.

### Lieferung

Die Lieferung lagert höchstens den freien Platz im Warehouse ein; der Rest verfällt
(siehe `docs/station-capacities.md`).

## Zeit- und Leistungsmodell

```text
Abbauzeit       = Ladungsmenge / Abbaurate
Flugzeit        = Entfernung / (Geschwindigkeit × 80)
Rundlaufzeit    = Abbauzeit + 2 × Flugzeit
Lieferleistung  = Ladungsmenge / Rundlaufzeit
```

Eine Mole (`600/h`, 100 Frachtraum) baut 10 Minuten ab:

- 2 Minuten Flug pro Strecke: 14 Minuten Rundlauf, etwa `429/h`;
- 4 Minuten Flug pro Strecke: 18 Minuten Rundlauf, etwa `333/h`;
- 10 Minuten Flug pro Strecke: 30 Minuten Rundlauf, `200/h`.

Die Vorschau rechnet für mehrere gleiche Miner linear, solange genug Vorrat bleibt. Angezeigte Zeiten
und Raten stammen aus demselben Modell wie die Simulation.

Damit hat jeder Schiffswert eine Bedeutung: Abbaurate verkürzt die Arbeitsphase, Geschwindigkeit
lohnt sich auf langen Strecken, Frachtraum verteilt die Reisezeit auf mehr Ladung, und ein
stärkerer Miner bringt mehr Leistung pro Hangarplatz.

## Baseline

Als Regressionstest in `apps/api/test/unit/asteroid-gen.test.ts` festgehalten:

- Eine neue Station beginnt mit drei Mole.
- Starterziele liegen 1,5–4,2 Flugminuten entfernt, ein Rundlauf dauert 12–19 Minuten.
- Eine Lieferung deckt einen spürbaren Teil des nächsten frühen Upgrades
  (siehe `docs/design-compass.md`).
- Ein kleiner Starterasteroid hält mit drei Mole etwa 2–4,5 Stunden.
