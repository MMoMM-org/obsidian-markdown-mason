---
title: "Phase 1: Pure core foundations"
status: in_progress
version: "1.0"
phase: 1
---

# Phase 1: Pure core foundations

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Implementation Examples/resolver]` — `resolveFormatSelectionRecipe`
- `[ref: SDD/Implementation Examples/tidyFootnotes]` — parameterized include-set
- `[ref: SDD/Data Storage Changes]` — `MasonSettings.formatSelection`
- `[ref: PRD Feature 2]` — default-on / missing-means-on
- Existing code: `src/core/types.ts` (`MasonSettings`, `DEFAULT_SETTINGS`, `OperationContext`, `EditPlan`); `src/core/noteFootnotes.ts:592` (`tidyFootnotes`), `diffToEditPlan`; `wholeNoteFromCitations` / `wholeNoteIdentity` / `wholeNoteMove`; `src/core/applyToString.ts`

**Key Decisions**:
- Missing/partial `formatSelection` resolves to all-on (resolver, never read fields directly).
- `tidyFootnotes` gains an OPTIONAL include-set defaulting to all-true → existing callers untouched (ADR-19 back-compat).
- Everything in this phase is pure (no `obsidian` import) — CON-2.

**Dependencies**: none — this is the spine Phases 2 and 3 build on.

---

## Tasks

- [x] **T1.1 Recipe type + resolver** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: Read the resolver example `[ref: SDD/Implementation Examples/resolver]` and `MasonSettings` in `src/core/types.ts`.
  2. Test (RED): `test/core/formatSelection.test.ts` — `resolveFormatSelectionRecipe({})` → all five `true`; a partial `{ move: false }` → `move:false`, other four `true`; an explicit all-false object is returned verbatim; result has exactly the five keys.
  3. Implement (GREEN): Create `src/core/formatSelection.ts` exporting `interface FormatSelectionRecipe { cascade; normalize; fromCitations; identity; move: boolean }` and `resolveFormatSelectionRecipe(settings: MasonSettings): FormatSelectionRecipe` (each field `?? true`). No `obsidian` import.
  4. Validate: unit tests pass; `tsc -noEmit`; `eslint`.
  - Success: missing/partial settings resolve to all-on; explicit false respected `[ref: PRD Feature 2; SDD/Implementation Examples/resolver]`.

- [ ] **T1.2 Settings field + defaults** `[activity: data-architecture]`

  1. Prime: Read `MasonSettings` + `DEFAULT_SETTINGS` in `src/core/types.ts`; import the new `FormatSelectionRecipe` from T1.1.
  2. Test (RED): extend a types/defaults test — `DEFAULT_SETTINGS.formatSelection` has all five `true`; `MasonSettings.formatSelection` is optional and accepts a `Partial`.
  3. Implement (GREEN): add `formatSelection?: Partial<FormatSelectionRecipe>` to `MasonSettings`; set `DEFAULT_SETTINGS.formatSelection = { cascade: true, normalize: true, fromCitations: true, identity: true, move: true }`.
  4. Validate: tests pass; `tsc -noEmit`; `eslint`.
  - Success: defaults are all-on; older saved data without the field still resolves to all-on via T1.1 `[ref: SDD/Data Storage Changes; PRD Feature 2]`.

- [ ] **T1.3 Parameterize `tidyFootnotes`** `[activity: domain-modeling]`

  1. Prime: Read `tidyFootnotes` (`src/core/noteFootnotes.ts:592`) and `diffToEditPlan`; note the offset-fused scratch-string stages C→O+D→M.
  2. Test (RED): in `test/scripts/.../tidyFootnotes` (existing) + new cases — `tidyFootnotes(ctx)` (no arg) is byte-identical to the current behavior on a fixture with all three operations (regression); for EACH subset of `{fromCitations, identity, move}` the omitted stage's effect is absent and the others still apply; all-skipped → `[]`; any included-but-changed result is a single `Edit` (via `diffToEditPlan`).
  3. Implement (GREEN): add `interface FootnoteSteps { fromCitations?: boolean; identity?: boolean; move?: boolean }`; change signature to `tidyFootnotes(ctx, include: FootnoteSteps = {})`; resolve each flag `?? true`; run each stage only if included, else its plan is `[]` and the scratch string passes through; keep the `afterM === original → []` and `diffToEditPlan` tail.
  4. Validate: tests pass; `tsc -noEmit`; `eslint`; confirm `wholeNoteFromCitations/Identity/Move` unchanged.
  - Success: no-arg call unchanged (back-compat); every subset omits exactly the skipped stage; single-edit invariant holds `[ref: SDD/Implementation Examples/tidyFootnotes; PRD Feature 1]`.

## Phase Validation
- `tsc -noEmit`, `eslint src/`, `vitest run` for the new/changed core tests all green.
- Compliance: `src/core/formatSelection.ts` has zero `obsidian` imports.
- `tidyFootnotes(ctx)` with no include arg is provably unchanged.
