/** Abhängigkeitsregeln der API (nach xitavis-next). Schichten und Ordner: apps/api/src/services/README.md. */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Keine Zyklen.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Auch reine Typ-Importe zählen als Abhängigkeit.
    tsPreCompilationDeps: true,
  },
};
