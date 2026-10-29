/** Abhängigkeitsregeln der API (nach xitavis-next). Schichten und Ordner: apps/api/src/services/README.md. */
/**
 * Schichten der Service-Ordner, von unten nach oben. Ein Ordner importiert nur Ordner
 * niedrigerer Schichten, nie die eigene oder eine höhere. Bezüge nach oben laufen über
 * Parameter oder Rückgabewerte, nicht über Importe.
 */
const LAYERS = [
  ['auth', 'research', 'map', 'logbook', 'ranking'],
  ['station'],
  ['world', 'mining', 'combat', 'missions'],
  ['transport'],
  ['bot'],
  ['simulation'],
];

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Keine Zyklen.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'services-only-via-index',
      severity: 'error',
      comment: 'Ein Service-Ordner wird von außen nur über seine index.ts importiert.',
      from: { path: '^apps/api/src/services/([^/]+)/' },
      to: {
        path: '^apps/api/src/services/',
        pathNot: ['^apps/api/src/services/$1/', '^apps/api/src/services/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'no-own-index',
      severity: 'error',
      comment:
        'Innerhalb eines Service-Ordners direkt importieren, nicht über die eigene index.ts.',
      from: { path: '^apps/api/src/services/([^/]+)/.+' },
      to: { path: '^apps/api/src/services/$1/index\\.ts$' },
    },
    {
      name: 'outside-only-via-index',
      severity: 'error',
      comment: 'Routen, Werkzeuge und App-Start importieren Services nur über index.ts.',
      from: { pathNot: '^apps/api/src/services/' },
      to: { path: '^apps/api/src/services/', pathNot: '^apps/api/src/services/[^/]+/index\\.ts$' },
    },
    {
      name: 'lib-is-base',
      severity: 'error',
      comment: 'lib ist die Basis und kennt weder Services, Routen noch Werkzeuge.',
      from: { path: '^apps/api/src/lib/' },
      to: {
        path: '^apps/api/src/(services|routes|tools|middleware|plugins)/|^apps/api/src/[^/]+\\.ts$',
      },
    },
    {
      name: 'services-not-from-entrypoints',
      severity: 'error',
      comment: 'Services kennen weder Routen noch Werkzeuge noch den App-Start.',
      from: { path: '^apps/api/src/services/' },
      to: { path: '^apps/api/src/(routes|tools)/|^apps/api/src/[^/]+\\.ts$' },
    },
    {
      name: 'routes-use-services',
      severity: 'error',
      comment:
        'Routen fragen die Datenbank nicht selbst ab; das tun Services (Health-Check ausgenommen).',
      from: { path: '^apps/api/src/routes/', pathNot: '^apps/api/src/routes/health/' },
      to: { path: '^apps/api/src/lib/db/|^node_modules/drizzle-orm/' },
    },
    ...layerRules(),
    {
      name: 'nobody-imports-tools',
      severity: 'error',
      comment: 'Werkzeuge (Playtest, Reports) sind Einstiegspunkte, kein Baustein.',
      from: { pathNot: '^apps/api/src/tools/' },
      to: { path: '^apps/api/src/tools/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Auch reine Typ-Importe zählen als Abhängigkeit.
    tsPreCompilationDeps: true,
  },
};

function layerRules() {
  return LAYERS.flatMap((layer, i) =>
    layer.map((name) => ({
      name: `layer-${name}`,
      severity: 'error',
      comment: `services/${name} (Schicht ${i + 1}) importiert nur niedrigere Schichten.`,
      from: { path: `^apps/api/src/services/${name}/` },
      to: {
        path: `^apps/api/src/services/(${LAYERS.slice(i).flat().join('|')})/`,
        pathNot: `^apps/api/src/services/${name}/`,
      },
    }))
  );
}
