export const meta = {
  name: 'audit-loop',
  description:
    'Repo audit above the ledger threshold, adversarial verify, central fixes, npm run verify; repeats until no confirmed findings',
  whenToUse:
    'Repeated whole-repo audit with fixes. Args: { date, maxRounds, startRound?, changedFiles? }',
  phases: [
    { title: 'Audit', detail: 'one finder per area plus lock/queue and guard lenses' },
    { title: 'Triage', detail: 'dedupe, drop below threshold and ledger items' },
    { title: 'Verify', detail: 'one skeptic per finding tries to refute it' },
    { title: 'Plan', detail: 'group by root cause, central fix first' },
    { title: 'Fix', detail: 'batches applied one after another in the working tree' },
    { title: 'Gate', detail: 'npm run verify, ledger entry' },
  ],
};

const MAX_ROUNDS = (args && args.maxRounds) || 2;
const DATE = (args && args.date) || 'ohne Datum';
const START_ROUND = (args && args.startRound) || 1;

const AREAS = [
  {
    key: 'core',
    prefixes: [
      'apps/api/src/lib/',
      'apps/api/src/services/simulation/',
      'apps/api/src/index.ts',
      'apps/api/src/app.ts',
      'apps/api/src/seed.ts',
    ],
    focus:
      'world tick, claiming due work, advisory locks, migrations and schema, realtime, execution context, startup seeding',
  },
  {
    key: 'station',
    prefixes: ['apps/api/src/services/station/', 'apps/api/src/services/research/'],
    focus:
      'build, defense, shipyard and research queues, payment, refunds, slot rules, research effects',
  },
  {
    key: 'combat',
    prefixes: ['apps/api/src/services/combat/', 'apps/api/src/services/missions/'],
    focus: 'attacks, destruction, debris and salvage, expeditions and colonies',
  },
  {
    key: 'movement',
    prefixes: [
      'apps/api/src/services/fleet/',
      'apps/api/src/services/transport/',
      'apps/api/src/services/mining/',
      'apps/api/src/services/map/',
      'apps/api/src/services/world/',
    ],
    focus: 'trips and arrivals, mining assignments, map and world views, scanner visibility',
  },
  {
    key: 'bot',
    prefixes: ['apps/api/src/services/bot/'],
    focus:
      'bot decisions, goals, intents; bots must use the same services and rules as players and never get stuck',
  },
  {
    key: 'edge',
    prefixes: [
      'apps/api/src/routes/',
      'apps/api/src/services/auth/',
      'apps/api/src/services/ranking/',
      'apps/api/src/services/logbook/',
      'apps/api/src/middleware/',
      'apps/api/src/plugins/',
      'packages/',
    ],
    focus:
      'trust boundary: route schemas, auth, ownership checks, response filtering; shared schemas and game-config rules',
  },
  {
    key: 'frontend',
    prefixes: ['apps/frontend/'],
    focus:
      'main player flows, stale or racing state, realtime handling, request load per event, blocked UI',
  },
  {
    key: 'tools',
    prefixes: ['apps/api/src/tools/', 'scripts/', 'configs/'],
    focus:
      'playtest runner and invariants; only what makes npm run verify fail falsely or hides real invariant breaks',
  },
];

const LENSES = [
  {
    key: 'locks',
    focus: `Cross-cutting lens over the whole API: every transaction, FOR UPDATE, advisory lock and claim of due work. Check against best practice:
- one consistent lock order across all paths that touch the same rows (deadlocks), short transactions, no realtime/network IO inside a transaction;
- every advisory lock key is namespaced so different lock purposes cannot collide on the same hash;
- due work (trips, builds, research, missions, bot decisions) is claimed atomically (FOR UPDATE SKIP LOCKED or conditional UPDATE ... WHERE status = ...), completed idempotently and at most once, survives restarts, and uses the row's due time, not the tick clock;
- check-then-act races under READ COMMITTED; retries/backoff that can double-apply effects.`,
  },
  {
    key: 'guards',
    focus: `Cross-cutting lens over the whole API: rules that are checked separately in several services instead of once, early, where the class of bug would be caught for every caller.
- ownership, visibility/scanner filtering, status and input bounds re-implemented per service where one copy is missing or has drifted;
- missing validation at the route schema (trust boundary) that services then must defend against;
- missing DB constraints (non-negative amounts, uniqueness, foreign keys, enum states) that would turn a code bug into silent corruption.
Only report concrete, traceable failure scenarios; a duplicate without a demonstrated wrong result is below the threshold.`,
  },
];

const BASE = `You are part of a repeated audit loop on this repo. Read docs/audit-ledger.md first. Its "Schwelle" section defines what counts as a finding; everything else is out of scope. Anything listed under "Erledigt", "Bewusst offen" or a "Runden" entry must not be reported again unless its existing fix is demonstrably broken or incomplete (then say so explicitly). Do not edit any files.`;

const FINDING = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    file: { type: 'string' },
    line: { type: 'integer' },
    category: {
      type: 'string',
      enum: ['zustand', 'regel', 'sichtbarkeit', 'sicherheit', 'betrieb', 'blockiert'],
    },
    scenario: {
      type: 'string',
      description:
        'concrete input or state -> wrong result, traced through the code with file:line references',
    },
    fix_idea: { type: 'string', description: 'where to catch the root cause once, and how' },
  },
  required: ['title', 'file', 'line', 'category', 'scenario', 'fix_idea'],
};
const FINDINGS = {
  type: 'object',
  properties: { findings: { type: 'array', items: FINDING } },
  required: ['findings'],
};
const TRIAGE = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ...FINDING.properties,
          id: { type: 'string' },
          locations: { type: 'array', items: { type: 'string' } },
        },
        required: [...FINDING.required, 'id'],
      },
    },
    dropped: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, reason: { type: 'string' } },
        required: ['title', 'reason'],
      },
    },
  },
  required: ['findings', 'dropped'],
};
const VERDICT = {
  type: 'object',
  properties: {
    confirmed: { type: 'boolean' },
    reason: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['confirmed', 'reason'],
};
const PLAN = {
  type: 'object',
  properties: {
    batches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          finding_ids: { type: 'array', items: { type: 'string' } },
          root_cause: { type: 'string' },
          approach: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          test: { type: 'string' },
        },
        required: ['name', 'finding_ids', 'root_cause', 'approach', 'files', 'test'],
      },
    },
  },
  required: ['batches'],
};
const FIX = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'failed'] },
    fixed_ids: { type: 'array', items: { type: 'string' } },
    skipped: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, reason: { type: 'string' } },
        required: ['id', 'reason'],
      },
    },
    changed_files: { type: 'array', items: { type: 'string' } },
    tests_run: { type: 'string' },
  },
  required: ['status', 'fixed_ids', 'changed_files', 'tests_run'],
};
const GATE = {
  type: 'object',
  properties: { verify_passed: { type: 'boolean' }, summary: { type: 'string' } },
  required: ['verify_passed', 'summary'],
};

const areaOf = (file) => (AREAS.find((a) => a.prefixes.some((p) => file.startsWith(p))) || {}).key;

const history = [];
// Repo-relative paths; set via args when continuing an earlier run.
let changedLastRound = (args && args.changedFiles) || null;

for (let round = START_ROUND; round < START_ROUND + MAX_ROUNDS; round++) {
  const roundNote = changedLastRound
    ? `\nThis is round ${round}. Files changed by the previous round's fixes: ${changedLastRound.join(', ')}. Check especially whether those fixes are correct, complete and did not introduce new issues.`
    : '';
  const areas = changedLastRound
    ? AREAS.filter((a) => changedLastRound.some((f) => areaOf(f) === a.key))
    : AREAS;
  const finders = [
    ...areas.map((a) => ({
      key: a.key,
      prompt: `Audit area: ${a.prefixes.join(', ')}. Focus: ${a.focus}. Follow calls into other modules where the scenario needs it.`,
    })),
    ...LENSES.map((l) => ({ key: l.key, prompt: l.focus })),
  ];
  log(`Runde ${round}: ${finders.length} Prüfer (${finders.map((f) => f.key).join(', ')})`);

  phase('Audit');
  const raw = (
    await parallel(
      finders.map(
        (f) => () =>
          agent(
            `${BASE}\n\n${f.prompt}${roundNote}\n\nReport ONLY findings above the threshold, each with a concrete failure scenario you traced through the actual code. Zero findings is a valid and expected answer; do not pad. Fewer, certain findings beat many plausible ones. For each, say where the root cause can be caught once (shared helper, route schema, DB constraint, central lock) instead of per service.`,
            { label: `audit:${f.key}`, phase: 'Audit', schema: FINDINGS }
          ).then((r) => (r ? r.findings.map((x) => ({ ...x, source: f.key })) : []))
      )
    )
  )
    .filter(Boolean)
    .flat();
  log(`Runde ${round}: ${raw.length} Rohbefunde`);
  if (!raw.length) {
    history.push({ round, confirmed: 0 });
    break;
  }

  phase('Triage');
  const triage = await agent(
    `${BASE}\n\nTriage these raw audit findings from several independent auditors:\n${JSON.stringify(raw, null, 1)}\n\nMerge duplicates and findings with the same root cause into one (keep every location in "locations"). Drop findings that are below the ledger threshold or already covered by the ledger, with a one-line reason each. Assign ids R${round}-1, R${round}-2, ... Open code only where needed to judge a duplicate.`,
    { label: 'triage', phase: 'Triage', schema: TRIAGE }
  );
  log(`Runde ${round}: ${triage.findings.length} nach Triage, ${triage.dropped.length} verworfen`);

  phase('Verify');
  const verdicts = await parallel(
    triage.findings.map(
      (f) => () =>
        agent(
          `${BASE}\n\nYou are a skeptic. Try to REFUTE this audit finding by reading the actual code paths end to end:\n${JSON.stringify(f, null, 1)}\n\nRefute it if the scenario cannot happen (a guard, lock, constraint or caller rules it out), if it is below the ledger threshold, or if the ledger already covers it. Confirm only if you traced the full scenario and it produces the wrong result. You may run existing tests read-only. If you remain uncertain, refute.`,
          { label: `verify:${f.id}`, phase: 'Verify', schema: VERDICT }
        ).then((v) => ({ ...f, verdict: v }))
    )
  );
  const judged = verdicts.filter(Boolean);
  const confirmed = judged.filter((f) => f.verdict && f.verdict.confirmed);
  const refuted = judged.filter((f) => !f.verdict || !f.verdict.confirmed);
  log(`Runde ${round}: ${confirmed.length} bestätigt, ${refuted.length} widerlegt`);

  let fixes = [];
  let plan = { batches: [] };
  if (confirmed.length) {
    phase('Plan');
    plan = await agent(
      `${BASE}\n\nThese findings were confirmed by an independent skeptic:\n${JSON.stringify(confirmed, null, 1)}\n\nPlan the fixes. Group findings by root cause into batches. Prefer one central fix that catches the whole class early (route schema at the trust boundary, shared helper, DB constraint, one lock helper with a fixed order) over a check in each service. Follow the lock and queue practices in the ledger section "Bevorzugte Fixes". Respect apps/api/src/services/README.md (layers, data ownership). Each batch names the files it touches and the one focused automated test that proves it. Order batches so foundations come first; avoid two batches touching the same file.`,
      { label: 'plan', phase: 'Plan', schema: PLAN }
    );

    phase('Fix');
    for (const batch of plan.batches) {
      const items = confirmed.filter((f) => batch.finding_ids.includes(f.id));
      const result = await agent(
        `Implement this fix batch in the working tree.\n\nBatch: ${JSON.stringify(batch, null, 1)}\n\nFindings:\n${JSON.stringify(items, null, 1)}\n\nRules: smallest complete change that fixes the root cause where the plan says; schema changes include the SQL migration and schema export; add the focused test from the plan; run \`npm run check\` and the smallest relevant unit or integration test until both pass. Earlier batches of this round already changed the working tree: keep their changes. Do not commit. If a finding turns out to be false while fixing, skip it and say why.`,
        { label: `fix:${batch.name}`, phase: 'Fix', schema: FIX }
      );
      fixes.push({
        batch: batch.name,
        ...(result || {
          status: 'failed',
          fixed_ids: [],
          changed_files: [],
          tests_run: 'agent died',
        }),
      });
    }
  }

  phase('Gate');
  const gate = await agent(
    `Round ${round} of the audit loop (${DATE}) is done.\n\nConfirmed and fix results: ${JSON.stringify(fixes, null, 1)}\nConfirmed findings: ${JSON.stringify(
      confirmed.map((f) => ({ id: f.id, title: f.title, file: f.file })),
      null,
      1
    )}\nRefuted: ${JSON.stringify(
      refuted.map((f) => ({
        title: f.title,
        file: f.file,
        reason: f.verdict ? f.verdict.reason : 'verifier died',
      })),
      null,
      1
    )}\nDropped in triage: ${JSON.stringify(triage.dropped, null, 1)}\n\n1. ${confirmed.length ? "Run `npm run verify` (long: it builds, runs integration tests in Docker and the playtest e2e). Run it in the background with its output and a final `echo EXIT $?` going to a log file, then block until that EXIT line appears (Monitor with an until-loop on the log). Never report before it finished; a background run dies with you. If it fails because of this round's changes (see git diff), fix that and rerun until it passes. Do not commit." : 'No code changed this round; skip npm run verify.'}\n2. Append to docs/audit-ledger.md under "## Runden" a section "### Runde ${round} (${DATE})" in German, one short line each: fixed findings (Bereich, Befund, Fix), findings that were skipped or only partly fixed, "Geprüft, kein Befund:" for refuted ones with the reason, and "Unter der Schwelle:" for dropped ones. This keeps later audits from raising them again. Then run Prettier on that file.`,
    { label: `gate:r${round}`, phase: 'Gate', schema: GATE }
  );

  history.push({
    round,
    raw: raw.length,
    confirmed: confirmed.length,
    refuted: refuted.length,
    dropped: triage.dropped.length,
    batches: plan.batches.map((b) => b.name),
    fixes,
    gate,
  });
  if (!confirmed.length) break;
  if (!gate || !gate.verify_passed) {
    log(`Runde ${round}: npm run verify nicht grün, Schleife stoppt`);
    break;
  }
  changedLastRound = [
    ...new Set(
      fixes
        .flatMap((f) => f.changed_files)
        .map((f) => f.replace(/^\/.*?\/(?=(apps|packages|scripts|configs|docs)\/)/, ''))
    ),
  ];
  if (round === START_ROUND + MAX_ROUNDS - 1)
    log(
      `Höchstzahl von ${MAX_ROUNDS} Runden erreicht, letzte Runde hatte noch ${confirmed.length} bestätigte Befunde`
    );
}

return { history };
