# Zielorientierte Bots und beschleunigter Spieltest

Stand: 27. Juli 2026.

## Ziel

Die Arbeit erfolgt in zwei aufeinander aufbauenden Schritten:

1. Bots werden glaubwürdige Bewohner der persistenten Spielwelt. Sie können Wirtschaft,
   Forschung, Expansion und Konflikt mit denselben Regeln und Services wie Spieler betreiben.
2. Erst auf dieser Entscheidungslogik entsteht ein separates beschleunigtes Entwicklungswerkzeug,
   das Balancingprobleme und festgefahrene Spielverläufe findet.

Der Spieltest ist kein Lasttest und kein Frontend-E2E-Test. Technische Last und Bedienoberfläche
bleiben eigene Prüfbereiche.

## Schritt 1: Glaubwürdige Bewohner

### Leitplanken

- Alle Bots beherrschen alle vier Spielbereiche. Der Spielstil gewichtet sie, verbietet aber keinen
  davon.
- Bots verwenden ausschließlich eigene sowie regulär öffentlich sichtbare Informationen.
- Aktionen laufen über dieselben Domain-Services, Kosten, Zeiten, Kapazitäten, Eigentums- und
  Sichtbarkeitsregeln wie Spieleraktionen.
- Pro fälliger Entscheidung wird höchstens eine erfolgreiche Aktion ausgelöst.
- Entscheidungen bleiben deterministisch, reproduzierbar und durch einen gespeicherten Grund
  erklärbar.
- Es entstehen keine Aktionsqueue, kein Behavior Tree, kein allgemeiner KI-Planer und kein freies
  Ziel-JSON.

### Langfristige Spielstile

Jeder Bot erhält dauerhaft eines von vier Profilen. Folgende Gewichte sind Ausgangswerte für den
späteren Balancetest:

| Stil          | Wirtschaft | Forschung | Expansion | Konflikt |
| ------------- | ---------: | --------: | --------: | -------: |
| Industrieller |        1,5 |       0,8 |       0,9 |      0,6 |
| Pionier       |        1,0 |       0,8 |       1,5 |      0,7 |
| Technokrat    |        1,0 |       1,5 |       0,9 |      0,8 |
| Warlord       |        1,0 |       0,7 |       0,8 |      1,5 |

Zusätzlich beeinflusst das Profil nur wenige konkrete Parameter:

- Risikobereitschaft und Sicherheitsmarge;
- militärische Reserve;
- Gewicht zukünftiger Vorteile;
- Bereitschaft zur Kolonisation;
- Bereitschaft zu opportunistischen Angriffen.

### Ziele und Aktionen

Ein Ziel beschreibt ein überprüfbares Ergebnis. Eine Aktion ist nur der nächste legale Schritt
dorthin.

Vorgesehene konkrete Ziele:

- `stabilize_station`: eine neue oder schwache Station arbeitsfähig machen;
- `increase_income`: Mining-Durchsatz oder Ressourcenversorgung erhöhen;
- `increase_capacity`: Lager-, Hangar- oder andere Kapazitätsengpässe beseitigen;
- `research_technology`: eine bestimmte Technologie abschließen;
- `explore_sector`: einen bestimmten Frontier-Sektor entdecken;
- `establish_colony`: eine Station in einem bestimmten Sektor gründen und stabilisieren;
- `fortify_station`: eine bestimmte Station auf ein gewünschtes Schutzniveau bringen;
- `build_strike_force`: eine geplante Kampfkraft aufbauen;
- `retaliate`: auf einen konkreten früheren Angreifer reagieren;
- `raid`: einen opportunistischen Angriff durchführen;
- `salvage`: ein konkretes Trümmerfeld bergen.

Jedes Ziel kennt nur seine wenigen sinnvollen nächsten Schritte und verwendet gemeinsame
Prüfungen für Kosten, Kapazität, verfügbare Schiffe, Sichtbarkeit und laufende Arbeit.

Dringende Wartungsaktionen dürfen ein strategisches Ziel unterbrechen, ohne es zu ersetzen. Dazu
gehören insbesondere das erneute Zuweisen freier Miner, das Stabilisieren einer neuen Kolonie und
die Reaktion auf eine unmittelbare Bedrohung. Wartung darf keine für das aktive Ziel reservierten
Ressourcen verbrauchen.

### Zielbewertung und Bindung

Der Zielwert setzt sich nachvollziehbar zusammen aus:

```text
Grundbedarf
× Profilgewicht
+ aktuelle Gelegenheit
+ erwarteter langfristiger Nutzen
+ Fortschritts- und Bindungsbonus
- Kosten
- Risiko
- blockierte Voraussetzungen
```

Der Bot behält sein aktives Ziel, solange es gültig und erreichbar ist. Ein freiwilliger Wechsel
erfolgt nur, wenn ein anderes Ziel deutlich besser bewertet ist. Als erste Baseline muss dessen
Wert ungefähr 20 bis 25 Prozent höher liegen. Abschluss, Unmöglichkeit oder eine dringende
Bedrohung erlauben einen sofortigen Wechsel.

Bei Gleichstand entscheiden stabile Ziel- und Objektkennungen. Leicht versetzte, aber
deterministische Entscheidungszeiten verhindern synchron handelnde Botgruppen.

### Fortschritt und Stillstand

Eine Entscheidung ohne Aktion unterscheidet:

- `waiting`: Eine laufende Reise, Produktion, Forschung oder Lieferung verändert den Zustand.
- `saving`: Reguläres Einkommen arbeitet auf bekannte Kosten hin.
- `blocked`: Eine Voraussetzung fehlt und es existiert kein erkennbarer Weg dorthin.
- `complete`: Das Ziel ist erreicht.

Wiederholtes `blocked` ohne Fortschritt löst einen Zielwechsel aus. Diese Unterscheidung ist
gleichzeitig die Grundlage der späteren Softlock-Erkennung.

Der persistente Bot-Controller benötigt dafür nur:

- Strategieversion und Spielstil;
- aktiven Zieltyp und eine kleine Zielreferenz;
- Beginn des Ziels und letzten messbaren Fortschritt;
- nächsten Entscheidungszeitpunkt;
- letzte Aktion und lesbare Begründung.

Kampfgeschichte wird soweit möglich aus bestehenden Kampfberichten abgeleitet. Interne Ziele,
Scores und Gründe bleiben Spielern verborgen und stehen nur Logs, Tests und späteren
Admin-Werkzeugen zur Verfügung.

### Forschungsgrundlagen

Die erste Forschungsbasis besteht aus sechs einmaligen Technologien ohne Baum, Stufen oder
Abhängigkeiten. Werte sind bewusst vorläufig.

| Technologie               | Ausgangseffekt                                        |
| ------------------------- | ----------------------------------------------------- |
| Automated Shipyard        | 10 Prozent kürzere Bauzeit für Schiffe                |
| Extraction Algorithms     | 10 Prozent höhere Abbaurate für Miner                 |
| Modular Cargo Frames      | 10 Prozent mehr Fracht für Miner und Bergungsschiffe  |
| Vector Navigation         | 10 Prozent kürzere Reisezeit für alle Schiffe         |
| Combat Analytics          | 10 Prozent mehr Angriffskraft für Fighter             |
| Station Grid Optimization | 10 Prozent kürzere Gebäude- und Verteidigungsupgrades |

Der Forschungswert berücksichtigt Spielstil, aktuelle Ziele, vorhandene Einheiten, sofort
profitierende Vorgänge, Kosten und verdrängte Investitionen. Die Entscheidungsbegründung nennt den
konkreten Nutzen, beispielsweise entfernte Frontier-Ziele oder viele aktive Miner.

### Konfliktverhalten

Eine sichtbare Station ist zunächst neutral. Rivalität und zeitweilige Feindseligkeit entstehen
aus tatsächlichen Kampfberichten:

- Eingehende und wiederholte Angriffe sowie eigene Verluste erhöhen Feindseligkeit.
- Zeit, erfolgreiche Vergeltung und längere Ruhe bauen sie wieder ab.
- Es gibt ohne Diplomatiesystem keine permanente Feindliste.

Alle Stile dürfen Konflikte beginnen:

- Industrielle bei einem sehr guten Risiko-Ertrag-Verhältnis oder Ressourcenengpass;
- Pioniere zum Schutz wichtiger Frontier-Positionen;
- Technokraten bei einem nutzbaren Forschungs- oder Flottenvorteil;
- Warlords regelmäßig auf der Suche nach Beute und schwachen Gegnern.

Angriffsziele werden nur mit öffentlichen Merkmalen bewertet: Entfernung, sichtbare Stationsgröße,
militärische Aktivität, grobe Verteidigungs- und Gebäudeprofile sowie eigene frühere
Kampfberichte. Exakte fremde Bestände, Flotten und Verteidigungswerte bleiben unbekannt.

Die lokale militärische Reserve verwendet Kampfkraft statt Stückzahlen. Erste Ausgangswerte:

| Stil          | Normale lokale Reserve |
| ------------- | ---------------------: |
| Industrieller |              etwa 70 % |
| Pionier       |              etwa 60 % |
| Technokrat    |              etwa 60 % |
| Warlord       |           etwa 35–40 % |

Bedrohung, Stationswert und eine neue oder isolierte Kolonie erhöhen die Reserve. Ein Angriff
verwendet die kleinste Flotte, die die öffentliche Gegnerschätzung mit der stilabhängigen
Sicherheitsmarge übertrifft.

Innerhalb des Konfliktbereichs gilt:

- unmittelbare Bedrohung bevorzugt Verteidigung;
- kürzlicher Angriff und ausreichende Überlegenheit bevorzugen Vergeltung;
- überschüssige Kampfkraft und ein attraktives Ziel ermöglichen einen Raid;
- Ziel-Cooldowns verhindern Angriffsspam und endlose Rachezyklen;
- eine Niederlage verlängert, ein neuer eingehender Angriff verkürzt den Cooldown.

Bergung konkurriert anhand von Ressourcenwert, Entfernung und Frachtleistung direkt mit Mining.
Ein Bergungsschiff wird erst bei einem beobachtbaren, plausibel lohnenden Bedarf gebaut.

### Keine Stationsübernahme

Stationsübernahme wird vorerst vollständig entfernt. Kampf bleibt durch Beute, Verluste,
Abschreckung, wirtschaftlichen Schaden und Bergung relevant. Kolonisation ist der reguläre
Expansionsweg.

Die nur für die bisherige Sofortübernahme vorhandene Einflusslogik wird nicht als totes System
beibehalten. Eine spätere Eroberung wäre eine eigenständige, sichtbare Besatzungskampagne mit
mehreren Erfolgen, zeitlicher Gegenwehr und Verfall von Kontrolldruck; sie ist nicht Teil dieses
Plans.

### Schutz junger Accounts

Junge Accounts erhalten eine allgemeine serverseitige Angriffsprotektion:

- Sie gilt accountweit ab Gründung der ersten Station.
- Als erste Baseline werden 24 Stunden angesetzt.
- Der erste eigene Angriff beendet sie sofort.
- Neue Kolonien verlängern oder erneuern sie nicht.
- Menschen und Bots durchlaufen dieselbe Prüfung im Angriffs-Service.
- Die Weltkarte zeigt keinen Schutzstatus oder Countdown; ein abgewiesener Angriff erhält aber
  einen verständlichen Grund.

Die Dauer ist ein Balancingwert für den beschleunigten Spieltest.

### Mehrere eigene Stationen

Der Bot betrachtet alle eigenen Stationen. Jede erhält einen lokalen Gesundheitszustand aus
Einkommen, freien Minern, Kapazitäten, Ausbau und Bedrohung.

- Das Profil und die Konfliktgeschichte gelten accountweit.
- Ressourcen, Flotten, Verteidigungsbedarf und Wartung bleiben stationslokal.
- Neue Kolonien erhalten hohe Stabilisierungspriorität, bis sie selbstständig arbeiten.
- Strategische Aktionen stammen von der am besten geeigneten Station.
- Angriffe starten von der nahen Station, die nach Abzug ihrer Reserve genügend Kampfkraft besitzt.
- Ohne reguläre Transportmechanik werden weder Ressourcen noch Flotten zwischen Stationen
  erfunden.
- Stationen erhalten zunächst keine fest konfigurierten Wirtschafts- oder Militärrollen; ihre Rolle
  folgt aus Lage, Zustand und Spielstil.

## Schritt 2: Beschleunigter Spieltest

Status: technisch umgesetzt und am 30. Juli 2026 mit drei reproduzierbaren 24-Stunden-Seeds
abgenommen. Ergebnisse und nächste Balancefragen stehen in der
[Playtest-Baseline](./playtest-baseline.md).

Nach Fertigstellung der zielorientierten Bots entsteht ein separates Entwicklungswerkzeug auf
einer wegwerfbaren PostgreSQL-Testwelt.

### Ablauf

- Der Lauf verwendet eine explizite virtuelle Zeit. Produktionscode verwendet weiterhin standardmäßig
  die reale Uhr.
- Zeitabhängige Domain-Services erhalten denselben virtuellen Zeitpunkt, damit Reise-, Bau-,
  Forschungs-, Schutz- und Entscheidungsdauer ihre korrekten Verhältnisse behalten.
- Der Runner erhöht die virtuelle Zeit in kleinen festen Schritten und verarbeitet jeweils den
  normalen Welttakt.
- Synthetische Spieler treten in einem konfigurierbaren Abstand bei, belegen normale Spielerplätze
  und erhalten danach einen Bot-Controller.
- Sektorgebundene Bewohner-Bots und synthetische Spieler bleiben im Bericht unterscheidbar, nutzen
  aber dasselbe Bot-Gehirn.
- Seed, Laufdauer, Beitrittsabstand, Populationsgrenze und Profilverteilung sind konfigurierbar und
  werden im Bericht festgehalten.
- Ein Lauf benötigt weder Browser noch HTTP-Automation und schläft nicht in Echtzeit.

Die Testwelt muss technisch von Entwicklungs- und Produktivdaten getrennt sein. Das Werkzeug darf
keine bestehende Welt zurücksetzen oder wiederverwenden.

### Messwerte

Der Abschlussbericht enthält mindestens:

- Zeitanteil, Auswahl, Wechsel, Abschluss und Blockade je Ziel;
- erfolgreiche, fehlgeschlagene, wartende und sparende Entscheidungen;
- Fortschrittsmeilensteine je Spielstil;
- Mining-Durchsatz, Ressourcenengpässe, Lagerverluste und Asteroidenerschöpfung;
- Gebäude-, Forschungs- und Flottenentwicklung;
- Expeditionen, Kolonien und Stabilisierung neuer Stationen;
- Angriffe, Verluste, Beute, Zielverteilung, Vergeltung und Schutzablehnungen;
- erzeugte, geborgene und liegen gebliebene Trümmer;
- Weltwachstum und Ressourcenverteilung nach Sektor.

Konsolenausgabe fasst den Lauf kompakt zusammen; eine maschinenlesbare JSON-Datei enthält die
Details. Ein Dashboard ist für die erste Version nicht erforderlich.

### Softlock- und Balancehinweise

Als auffällig gelten insbesondere:

- ein unvollständiges Ziel bleibt über einen langen Zeitraum `blocked`;
- ein Bot erzielt trotz erlaubter Aktionen keinen messbaren Fortschritt;
- eine neue Kolonie erreicht keine eigene Rohstoffversorgung;
- dasselbe Ziel oder dieselbe fehlgeschlagene Aktion wiederholt sich ohne Zustandsänderung;
- ein Bot wechselt Ziele ungewöhnlich häufig;
- benötigte Ressourcen sind unerreichbar und lösen trotzdem keine Expansion aus;
- Hangar, Lager oder Bauqueues blockieren den Fortschritt dauerhaft;
- Konfliktprofile greifen nie an oder friedlichere Profile vernachlässigen dauerhaft ihre
  Entwicklung.

Harte Invarianten wie negative Ressourcen, doppelte Fertigstellungen, Regelumgehung oder
unzulässige Sichtbarkeit lassen den Lauf fehlschlagen. Balancingauffälligkeiten erscheinen zunächst
als Bericht und werden erst nach belastbaren Baselines zu Testgrenzen.

## Umsetzungsreihenfolge

Die konkreten, einzeln abnehmbaren Arbeitspakete für Schritt 1 stehen im
[Ticketpaket für glaubwürdige Bewohner](./goal-driven-bots-step-1-tickets.md).
Die Nachbesserungen der ersten Implementierung und ihre Abnahmekriterien stehen im
[Fix- und Reviewplan für Schritt 1](./goal-driven-bots-step-1-fix-plan.md).
Die konkrete Umsetzung von Schritt 2 steht im
[Ticketpaket für den beschleunigten Spieltest](./goal-driven-bots-step-2-tickets.md).

1. Sofortübernahme und die ausschließlich dafür vorhandene Einflusslogik entfernen.
2. Accountweiten Schutz junger Stationen im gemeinsamen Angriffs-Service ergänzen.
3. Die sechs Forschungsgrundlagen und ihre serverseitigen Effekte umsetzen.
4. Bot-Controller um Strategieversion, Profil und minimalen Zielzustand erweitern.
5. Bot-State auf alle eigenen Stationen und regulär sichtbare Chancen ausbauen.
6. Zielbewertung, Bindung, Fortschrittszustände und Wartungsaktionen implementieren.
7. Normale Intents für Gebäude, Forschung, Expedition, Kolonisation, Verteidigung, Kampf und
   Bergung ergänzen.
8. Je Profil und Spielbereich fokussierte Verhaltenstests sowie die aktualisierten Domainverträge
   ergänzen.
9. Virtuelle Zeit durch die betroffenen zeitabhängigen Service-Einstiegspunkte führen.
10. Wegwerfbaren Playtest-Runner, synthetische Beitritte, Berichte und Softlock-Erkennung ergänzen.
11. Reproduzierbare Baselines mit mehreren Seeds ausführen und erst danach Gewichte, Schutzdauer
    und Balancewerte anpassen.

`npm run check` und die jeweils kleinsten Verhaltenstests begleiten jeden Abschnitt. Nach
veränderten Spielmechaniken muss `npm run verify` bestehen.
