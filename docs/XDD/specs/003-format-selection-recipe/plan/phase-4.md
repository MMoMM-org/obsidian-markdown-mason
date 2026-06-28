---
title: "Phase 4: Integration & verification"
status: completed
version: "1.0"
phase: 4
---

# Phase 4: Integration & verification

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: PRD Success Metrics]` — no-regression, correctness, isolation
- `[ref: SDD/Quality Requirements]` — byte-identity, atomicity, purity
- `[ref: SDD/Acceptance Criteria (EARS)]` — full criteria list
- Mason dev loop: container build + host Obsidian via `.mason-dev.json` (never `npm run build` while dev-testing)

**Key Decisions**:
- Final gate before merge; the feature is additive and behind default-on settings.

**Dependencies**: Phases 1–3 complete.

---

## Tasks

- [x] **T4.1 Full gates + manual smoke** `[activity: test-strategy]` — automated gates all green (tsc, eslint, vitest 1239, production build, core-purity sweep); manual Obsidian smoke handed to maintainer (requires host Obsidian).

  1. Prime: Re-read PRD acceptance criteria and SDD Quality Requirements; map each to a passing test from Phases 1–3.
  2. Test (RED→GREEN already authored in prior phases): ensure the suite covers every EARS criterion — all-on byte-identity, per-step omission, all-off no-op, single-edit invariant, isolation, resolver defaults, settings persistence.
  3. Implement (GREEN): run the gates —
     - `npx tsc -noEmit -skipLibCheck`
     - `npx eslint src/`
     - `npx vitest run` (incl. the compliance sweep — assert `src/core/formatSelection.ts` imports no `obsidian`)
     - `node esbuild.config.mjs production` (bundle builds clean)
  4. Validate (manual smoke, per the Mason dev loop): build into the dev vault via `.mason-dev.json`; in Obsidian, open Settings → Mason → Format selection, untick "Move footnotes to resources"; select a block with citations and run "Format selection"; confirm definitions stay inline, the rest formats, and it is a single undo. Re-enable all; confirm full behavior returns. Disable all five; confirm "Nothing to format".
  - Success: all gates green; manual smoke matches the acceptance criteria `[ref: PRD Success Metrics; SDD/Acceptance Criteria]`.

## Phase Validation
- tsc + eslint + vitest + production build all green.
- Compliance sweep confirms core purity.
- Manual smoke confirms per-step omission, single undo, and the empty-recipe notice.
- Update `plan/README.md` phase checkboxes and the spec README status to reflect completion.
