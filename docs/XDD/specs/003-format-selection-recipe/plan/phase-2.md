---
title: "Phase 2: Command wiring"
status: pending
version: "1.0"
phase: 2
---

# Phase 2: Command wiring

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Implementation Examples/fusedFormatNote]` — gating design
- `[ref: SDD/ADR-19]` — only `fusedFormatNote` reads the recipe
- `[ref: PRD Feature 1]` — per-step omission; `[ref: PRD Feature 5]` — empty recipe
- `[ref: PRD Feature 4]` — isolation
- Existing code: `src/commands.ts` (`fusedFormatNote` 276, `cascadeSelectionPlan`, the "Format selection" command 385 with its empty-plan "Nothing to format" notice 390, the "Tidy footnotes" command 351, the per-entry command loop 406)

**Key Decisions**:
- `fusedFormatNote` reads `resolveFormatSelectionRecipe(plugin.settings)` fresh per run → live, no re-registration.
- "Tidy footnotes" keeps calling `tidyFootnotes(ctx)` (no include) — must NOT change.
- Result stays a single `Edit` via `diffToEditPlan`.

**Dependencies**: Phase 1 (resolver, settings field, parameterized `tidyFootnotes`). `[parallel: true]` with Phase 3.

---

## Tasks

- [ ] **T2.1 Gate `fusedFormatNote` on the recipe** `[activity: build-feature]`

  1. Prime: Read `fusedFormatNote` (`src/commands.ts:276`) and the SDD gating example.
  2. Test (RED): `test/commands/formatSelection.test.ts` —
     - all-on: output equals the legacy (pre-change) fused output on a fixture covering headings + citations + defs (byte-identical regression);
     - `move:false` (others on): no `## Resources` section is created / defs stay inline AND citations are still converted + renumbered (assert the positive half too, so the full F1.2 sentence is covered at the command level);
     - `normalize:false`: heading gaps are not closed but other steps still apply;
     - each single step off omits exactly that step;
     - all-off: returns `[]`;
     - any non-empty result is exactly one `Edit` (atomicity);
     - empty-recipe notice: the "Format selection" command path fires the existing "Nothing to format" Notice when the plan is `[]` (assert at the command level, not just manual smoke);
     - live effect: running `fusedFormatNote`, flipping a flag on the SAME `settings` object, then running again yields the changed result — locks the fresh-read-per-invocation invariant against future caching.
  3. Implement (GREEN): in `fusedFormatNote`, resolve the recipe; gate the `normalize` and `cascade` scratch stages on `recipe.normalize` / `recipe.cascade` (skip ⇒ pass the prior string through); call `tidyFootnotes(tidyCtx, { fromCitations: recipe.fromCitations, identity: recipe.identity, move: recipe.move })`; keep the final `diffToEditPlan(original, afterTidy)`.
  4. Validate: tests pass; `tsc -noEmit`; `eslint`. Confirm the existing "Format selection" command's empty-plan path still shows "Nothing to format".
  - Success: per-step omission works; all-on is byte-identical; all-off is a no-op notice; one undo step `[ref: SDD/Implementation Examples/fusedFormatNote; PRD Feature 1, 5]`.

- [ ] **T2.2 Isolation guarantees** `[activity: test-strategy]` `[parallel: true]`

  1. Prime: Read the "Tidy footnotes" command (`src/commands.ts:351`) and the per-entry command loop (406); re-read ADR-19.
  2. Test (RED): with `settings.formatSelection` set to several non-default recipes (incl. all-off) —
     - `tidyFootnotes(ctx)` output is unchanged (equals the all-included result);
     - the individual built-in commands (Cascade/Normalize headings, Convert citations, Resolve identity, Move) produce identical results regardless of `formatSelection`;
     - the `mason.*` API (`buildRegistry().api.*`) output is unaffected by `formatSelection`.
  3. Implement (GREEN): no production change expected — these tests prove the scoping. If any leakage is found, fix by removing the recipe read from that path.
  4. Validate: tests pass; `tsc -noEmit`; `eslint`.
  - Success: recipe affects ONLY "Format selection" `[ref: SDD/ADR-19; PRD Feature 4]`.

## Phase Validation
- `vitest run` green for command + isolation tests.
- "Tidy footnotes" and individual commands demonstrably ignore the recipe.
- "Format selection" all-on output matches the captured legacy baseline.
