---
agent: "agent"
description: "local pre-PR review against a base ref: checks standards, correctness, spec fit, validation, and complexity with minimal context."
argument-hint: "base ref, e.g. origin/main; optional spec path or ticket"
---

Do a local pre-PR review for this repository.

Goal: decide whether the current branch is ready for a high-quality pull request, while using as little context and as few tool calls as practical.

Review only:

- Do not modify files.
- Do not invent requirements.
- Report only concrete, diff-backed findings.
- Prefer fewer high-confidence findings over a long speculative list.

## Input

Review `HEAD` against a base ref.

If the user supplied a base ref, use it. If not, ask for it. Common examples: `origin/main`, `main`, `develop`, a tag, a commit SHA, or `HEAD~3`.

Use three-dot comparison against the merge base.

Start with cheap metadata only:

```sh
git rev-parse <base-ref>
git diff --stat <base-ref>...HEAD
git diff --name-only <base-ref>...HEAD
git log <base-ref>..HEAD --oneline
```

If the ref is invalid or the diff is empty, stop.

## Credit Budget

Minimize context:

- Do not use sub-agents.
- Do not scan the whole repository.
- Do not run broad text searches unless the diff names an unknown symbol or pattern.
- Read `.github/copilot-instructions.md` if present.
- Read only `AGENTS.md` files that apply to changed paths.
- Read nearby README files only when module boundaries or domain behavior changed.
- Inspect full file contents only for small files or files with central control flow.
- For large files, inspect changed hunks plus the nearest owning function, component, service, route, or test.
- Do not search for a spec unless the user gave a spec/ticket/path or commit messages clearly reference one.
- Do not run lint, tests, builds, generation, migrations, or formatters unless the user explicitly asks. Recommend commands instead.

If the diff is very large, review the highest-risk files first and say what was not inspected.

## Review Axes

Check only what the diff can support:

1. Standards: documented repo rules, structure, naming, generated files, reuse of existing patterns, no unrelated refactors.
2. Correctness and risk: edge cases, async/error paths, auth/permissions, data leakage, validation/response mismatches, migrations/transactions, backwards compatibility, sensitive data exposure.
3. Spec fit: only if a spec/ticket/path is supplied or obvious from commits; otherwise say `No spec available`.
4. Tests and validation: whether tests or local checks match the risk; recommend commands, do not run them by default.
5. Simplicity: meaningful overengineering only, such as speculative abstractions, one-use helpers, unnecessary dependencies, avoidable indirection, or custom code replacing native/repo utilities.

## Finding Rules

Each finding must include severity, path, problem, risk, and recommendation.

Severity: `blocker`, `major`, `minor`, or `nit`.

Do not report:

- pure style preferences
- issues already enforced by tooling unless they reveal a deeper problem
- broad opinions without a concrete risk
- unrelated pre-existing problems unless the diff makes them worse
- speculative security concerns without a plausible path

If uncertain, make it a question, not a finding.

## Output Format

Use this concise structure:

```md
## Summary
<2-4 sentences: readiness, biggest risk, what was skipped if anything>

## Findings
### Blocker
- None, or findings
### Major
- None, or findings
### Minor
- None, or findings
### Nit
- None, or findings

## Standards
<pass/fail summary>

## Correctness And Risk
<short risk summary>

## Spec Fit
<found spec, no spec available, or skipped reason>

## Tests And Validation
<covered, missing, recommended commands>

## PR Readiness
<Ready | Ready after minor fixes | Needs changes before PR | Not enough information>
Top actions: <1-3 bullets>
```
