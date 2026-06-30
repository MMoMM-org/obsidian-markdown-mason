---
title: "Phase 1: Shared cleanup helper & fusedFormatNote refactor"
status: completed
version: "1.0"
phase: 1
---

# Phase 1: Shared cleanup helper & fusedFormatNote refactor

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Implementation Examples/Example 1: applyTextCleanup]` — full reference implementation + StepLogger
- `[ref: SDD/Implementation Examples/Example 2: fusedFormatNote after refactor]`
- `[ref: SDD/Interface Specifications/Internal API Changes]` — `applyTextCleanup` signature; fusedFormatNote delegation
- `[ref: SDD/ADR-25]` (shared pure helper), `[ref: SDD/ADR-28]` (injected logger)
- `[ref: SDD/Constraints CON-1, CON-5]` — core purity; byte-identity
- `[ref: PRD Feature 4 / AC]` — recipe-path logging (4b); off→silent; never logs content
- Existing code: `src/commands.ts` (`fusedFormatNote` steps 1–9, `resolveFormatSelectionRecipe` import, `selectionContext`, `diffToEditPlan`, `debug`); `src/core/cleanup.ts`, `src/core/lists.ts`, `src/core/headings.ts` (`normalize` reads only `ctx.doc`), `src/core/applyToString.ts`, `src/core/debug.ts`

**Key Decisions**:
- `applyTextCleanup` runs the 7 gated steps in the exact order and gate semantics of `fusedFormatNote` steps 1–7, so the refactor is byte-identical (CON-5). It is pure (no `obsidian` import) and takes an optional `StepLogger` so logging never pollutes core (ADR-28).
- The 7 transforms read only `ctx.doc`; a minimal `OperationContext` (`cursor: 0`, empty settings) is equivalent to the full ctx for these steps.

**Dependencies**: none — this is the spine. Phase 2 depends on the helper.

---

## Tasks

This phase establishes the shared pure cleanup pipeline and proves the "Format selection" command is unaffected.

- [x] **T1.1 `src/core/formatPipeline.ts` — `applyTextCleanup` pure helper** `[activity: domain-modeling]`

  1. Prime: Read `[ref: SDD/Implementation Examples/Example 1]` (full reference impl) and `[ref: SDD/Interface Specifications/Internal API Changes]`. Confirm `normalize` (headings) reads only `ctx.doc`. Read `src/core/applyToString.ts` for the scratch-chaining model.
  2. Test (RED): `test/core/formatPipeline.test.ts` — write before the file exists:
     - Runs the 7 steps in order; a doc with multiple artifacts is fully cleaned (dehyphenate, dewrap, tidyWhitespace, decomposeLigatures, normalizeBullets, normalizeOrdered, normalize).
     - Each toggle off → that step is skipped (per-key: e.g. `{ dewrap:false }` leaves wrapped lines; others still apply).
     - The 4 non-cleanup keys (cascade, fromCitations, identity, move) are ignored (their values never change output).
     - Idempotency: applying `applyTextCleanup` to its own output returns the same string.
     - `StepLogger`: when a logger is passed, one line per step is emitted (skipped vs N edits); when omitted, no error and identical output.
     - CON-2: `grep` no `obsidian` import.
  3. Implement (GREEN): Create `src/core/formatPipeline.ts` exporting `StepLogger` and `applyTextCleanup(doc, recipe, log?)` per SDD Example 1. Zero `obsidian` import.
  4. Validate: unit tests pass; `tsc -noEmit`; `eslint`; `grep -rn "obsidian" src/core/formatPipeline.ts` → none.
  - Success: 7 gated steps run in order; toggles respected; idempotent; pure; logger optional `[ref: SDD/Example 1; SDD/ADR-25; PRD Feature 2 / AC — cleanup steps]`.

- [x] **T1.2 Refactor `fusedFormatNote` to delegate steps 1–7 + recipe-path logging (4b)** `[activity: build-feature]`

  1. Prime: Read `src/commands.ts` `fusedFormatNote` in full (current inline `s1..s9`). Read `[ref: SDD/Implementation Examples/Example 2]` and `[ref: SDD/ADR-28]`. **Before changing code**, capture `fusedFormatNote`'s current output on several dirty fixtures (for the regression assertion).
  2. Test (RED):
     - **Byte-identity regression** (extend `test/commands/formatSelection.test.ts`): for several dirty inputs + recipe configurations, `fusedFormatNote` output equals the pre-refactor captured output (the existing spec-004 "Format selection" tests must also stay green).
     - Recipe-path logging (4b): with `debugLogging` on, running the recipe emits per-step lines (skipped/edit-count) + a final-result line; with `debugLogging` off, nothing is logged; logs never contain document content.
  3. Implement (GREEN): In `src/commands.ts`, replace `fusedFormatNote` steps 1–7 with `const s7 = applyTextCleanup(original, recipe, gatedLog)`; keep cascade (8, null-guard) + tidyFootnotes (9) + `diffToEditPlan(original, s9)` exactly. Build a `debugLogging`-gated `StepLogger` (no-op when off).
  4. Validate: full `npx vitest run` (zero regressions); `tsc -noEmit`; `eslint`.
  - Success: "Format selection" output byte-identical (CON-5); recipe steps logged when debug on, silent when off, content-free `[ref: SDD/Example 2; SDD/CON-5; SDD/ADR-28; PRD Feature 4 / AC]`.

## Phase Validation

- `npx vitest run` green; `tsc -noEmit -skipLibCheck` + `eslint src/` clean.
- `grep -rn "obsidian" src/core/formatPipeline.ts` → zero (CON-2).
- `fusedFormatNote` byte-identity regression passes; all spec-004 "Format selection" tests still pass.
- Recipe-path logging present and debug-gated; no content logged.
