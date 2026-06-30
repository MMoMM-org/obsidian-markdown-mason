---
title: "Phase 4: Documentation & integration verification"
status: in_progress
version: "1.0"
phase: 4
---

# Phase 4: Documentation & integration verification

## Phase Context

**GATE**: Read all referenced files before starting this phase. Phases 2 and 3 must be complete.

**Specification References**:
- `[ref: PRD Feature 5 / AC]` — docs: three-command table; README/usage updated; troubleshooting entry
- `[ref: SDD/Acceptance Criteria (EARS)]` — full criteria map
- `[ref: SDD/Quality Requirements]` — correctness, regression, purity, privacy
- `[ref: PRD Success Metrics]` — verification methods (tests, byte-identity, smoke, log inspection)
- Existing docs: `README.md` (Features, Quick start, Commands table, clipboard note), `docs/commands-reference.md`, `docs/usage.md`, `docs/configuration.md`, `docs/troubleshooting.md`

**Key Decisions**:
- Docs must clearly distinguish the three commands and what each runs (the 7-vs-11 distinction). No new production source files in this phase — only docs + verification (fix gaps in the relevant earlier phase's files if found).

**Dependencies**: Phases 2 (commands) and 3 (settings marker).

---

## Tasks

This phase documents the commands and verifies the whole spec against the PRD.

- [x] **T4.1 Documentation: three-command distinction** `[activity: documentation]`

  1. Prime: Read the current `README.md` Commands section + `docs/commands-reference.md`, `docs/usage.md`, `docs/configuration.md`, `docs/troubleshooting.md`. Note every place the old "Paste and format" behavior is described.
  2. Test (verification, not unit): define the doc checklist — a command table distinguishing **"Paste and run scripts"** (converter scripts), **"Paste and format"** (7 cleanup steps, scoped to the paste), **"Format selection"** (full 11-step recipe on note/selection); README Features/Quick-start/clipboard-note updated to the new naming; a troubleshooting entry for "pasted as-is / why didn't it format".
  3. Implement: Update `README.md`, `docs/commands-reference.md`, `docs/usage.md`, `docs/configuration.md`, and add the `docs/troubleshooting.md` entry. Include the command/step table.
  4. Validate: docs render correctly; the table matches the implemented step subsets; no stale references to the old single "Paste and format" script behavior remain.
  - Success: a reader can pick the right command; the 7-vs-11 distinction is documented `[ref: PRD Feature 5 / AC]`.

- [ ] **T4.2 Integration & verification: gates, AC map, build, smoke** `[activity: test-strategy]`

  1. Prime: Read `[ref: SDD/Acceptance Criteria (EARS)]` and `[ref: PRD]` (all 22 ACs). Confirm `test/compliance.test.ts` CON-2 sweep covers `src/core/formatPipeline.ts` (it scans all `src/core/*.ts`).
  2. Test (verify GREEN):
     - **PRD AC map:** every one of the 22 acceptance criteria maps to a named passing test; document the mapping (comment block or checklist). Add any missing assertion in the relevant earlier phase's test file.
     - **Byte-identity:** the `fusedFormatNote` regression test (Phase 1) is green.
     - **Build gate:** `node esbuild.config.mjs production` → zero errors; `main.js` emitted.
     - **Manual smoke checklist (maintainer-run):** (a) "Paste and format" on messy clipboard cleans + one undo; (b) toggling a cleanup step off changes "Paste and format" output; (c) "Paste and run scripts" still runs converters / raw-pastes; (d) the four non-applicable toggles show the settings marker; (e) with debug logging on, both the script `canHandle` lines and the recipe per-step lines appear and contain no clipboard/document content.
  3. Implement (only if gaps found): add missing test assertions in the owning phase's test file; fix build errors at the source. No net-new production source files here.
  4. Validate: `tsc -noEmit -skipLibCheck`, `eslint src/`, `npx vitest run` all green; production build succeeds; CON-2 sweep covers `formatPipeline.ts`.
  - Success: every PRD AC has a passing test; build is green; smoke checklist passes `[ref: SDD/Quality Requirements; SDD/Acceptance Criteria; PRD Success Metrics]`.

## Phase Validation

- `npx tsc -noEmit -skipLibCheck` + `eslint src/` + `npx vitest run` → all green.
- `node esbuild.config.mjs production` → `main.js` emitted, zero errors.
- All 22 PRD acceptance criteria mapped to passing tests.
- `src/core/formatPipeline.ts` covered by the CON-2 purity sweep.
- Docs distinguish the three commands; manual smoke checklist passes.
- Plan README phases checklist all `[x]`; spec README → Implemented.
