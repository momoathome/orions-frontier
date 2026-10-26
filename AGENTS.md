# Orion's Frontier

## Product

Orion's Frontier is a persistent shared-world idle game. Players make economic and strategic
decisions; the game automates execution and offline progress. Prefer a complete, understandable
player-facing loop over a broader simulation or content catalog. Add systems only for a demonstrated
gameplay need.

## Invariants

- PostgreSQL is the source of truth. Persistent state transitions must be atomic under concurrency.
- Timed work must survive restarts and complete idempotently, at most once.
- Bots use the same domain services, costs, ownership, and visibility rules as players.
- Filter private and scanner-limited information on the server; never rely on the client to hide it.
- Keep world generation and rule calculations deterministic and explainable.

## Working Rules

- Make the smallest change that fully solves the request; reuse existing code before adding an
  abstraction, dependency, process, or parallel rule path.
- Preserve unrelated working-tree changes. Never expose secrets or edit generated output.
- Schema changes include the matching SQL migration and schema export.
- Non-trivial game behavior gets one focused automated check, especially for concurrency, ownership,
  visibility, costs, and time-based completion.

## Verification

Run `npm run check` after code changes and the smallest relevant unit or integration test. Run
`npm run verify` for a new or changed game mechanic. Documentation-only changes need only a focused
Prettier check.
