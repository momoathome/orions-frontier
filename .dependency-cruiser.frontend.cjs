/** Abhängigkeitsregeln des Frontends. Ordner und Regeln: apps/frontend/src/README.md. */
const FEATURES = '^apps/frontend/src/features/';

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Keine Zyklen, auch nicht über index.ts oder reine Typ-Importe.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'feature-only-via-index',
      severity: 'error',
      comment: 'Ein Feature wird von außen nur über seine index.ts importiert.',
      from: { path: `${FEATURES}([^/]+)/` },
      to: { path: FEATURES, pathNot: [`${FEATURES}$1/`, `${FEATURES}[^/]+/index\\.ts$`] },
    },
    {
      name: 'outside-only-via-index',
      severity: 'error',
      comment: 'App-Start, Router und shared importieren Features nur über index.ts.',
      from: { path: '^apps/frontend/src/', pathNot: FEATURES },
      to: { path: FEATURES, pathNot: `${FEATURES}[^/]+/index\\.ts$` },
    },
    {
      name: 'no-own-index',
      severity: 'error',
      comment: 'Innerhalb eines Features direkt importieren, nicht über die eigene index.ts.',
      from: { path: `${FEATURES}([^/]+)/.+`, pathNot: `${FEATURES}[^/]+/index\\.ts$` },
      to: { path: `${FEATURES}$1/index\\.ts$` },
    },
    {
      name: 'shared-imports-no-feature',
      severity: 'error',
      comment: 'shared/ ist die Basis und kennt keine Features.',
      from: { path: '^apps/frontend/src/shared/' },
      to: { path: `${FEATURES}|^apps/frontend/src/[^/]+\\.(ts|vue)$|^apps/frontend/src/router/` },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.ts', '.vue', '.js'],
    },
  },
};
