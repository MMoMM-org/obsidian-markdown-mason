---
title: "Phase 2: Core Operations (pure domain)"
status: in_progress
version: "1.0"
phase: 2
---

# Phase 2: Core Operations (pure domain)

## Phase Context

**GATE**: Read before starting.

**Specification References**:
- `[ref: SDD/Application Data Models]` `[ref: SDD/Complex Logic — fused Footnote-Identity]`
- `[ref: README §5 Algorithmen]`
- `[ref: PRD/Feature 1,2,3,4]`

**Key Decisions**:
- EditPlan return type, offsets vs ORIGINAL doc (ADR-1). Fused O+D (ADR-2). No `obsidian` import.

**Dependencies**: Phase 1 (test harness).

---

## Tasks

Delivers the pure, unit-tested operation logic that everything else composes. All tasks are
`[parallel: true]` after T2.1 (shared types).

- [x] **T2.1 Core types** `[activity: domain-modeling]`
  1. Prime: `[ref: SDD/Application Data Models]`
  2. Test: type-level only — a compile fixture instantiating `Edit`, `EditPlan`, `OperationContext`, `FootnoteRef`, `ExistingRef`, `ParseResult`, `Operation`.
  3. Implement: `src/core/types.ts`.
  4. Validate: `tsc -noEmit` clean.
  - Success: shared contracts exist `[ref: SDD/Interface Specifications]`

- [x] **T2.2 URL normalization** `[activity: domain-modeling]` `[parallel: true]`
  1. Prime: `[ref: SDD/Complex Logic; normalizeUrl]`
  2. Test: lowercases scheme/host; strips trailing slash; sorts query; drops fragment; non-URL falls back to trimmed lowercase; the two `n-kishou.com/...?lang=en` occurrences in the fixtures normalize equal.
  3. Implement: `src/core/url.ts`.
  4. Validate: unit tests pass.
  - Success: equal URLs collapse `[ref: PRD/AC F3 dedup]`

- [x] **T2.3 Heading cascade + normalize (H)** `[activity: domain-modeling]` `[parallel: true]`
  1. Prime: `[ref: README §5 H]` `[ref: SDD/Heading edge cases]`
  2. Test: shift `(ctxLevel+1−minIn)`; H6 clamp; no-heading-above-cursor → unchanged + signal; no headings → no-op; whole-note `normalize` closes gaps and is distinct from cascade.
  3. Implement: `src/core/headings.ts` returning `EditPlan`.
  4. Validate: unit tests pass.
  - Success: `[ref: PRD/AC F1.1–F1.4]`

- [x] **T2.4 Footnote identity — fused O+D** `[activity: domain-modeling]` `[parallel: true]`
  1. Prime: `[ref: SDD/Complex Logic — traced walkthrough]` `[ref: README §5 O,D]`
  2. Test: reproduce the SDD traced example (`{1→7,2→6,3→7}`); alpha `[^A]` ignored for max/dedup/move; intra-paste dup collapses; existing-URL reuse (non-sequential `[^7]`); inline+definition updated together.
  3. Implement: `src/core/footnotes.ts` `resolveFootnoteIdentity` + EditPlan emitter.
  4. Validate: unit tests pass against the walkthrough.
  - Success: `[ref: PRD/AC F3.1–F3.4]`

- [ ] **T2.5 Citation→footnote (C) + move-to-Resources (M)** `[activity: domain-modeling]` `[parallel: true]`
  1. Prime: `[ref: README §5 C,M]` `[ref: PRD/Feature 2,4]`
  2. Test (C): converts a `ParseResult`'s inline markers to `[^n]`; leaves alpha untouched; no-op on empty. Test (M): two-line format; create `## Resources` at note end (configurable name, no callout) only when there are defs; orphaned resources untouched; nothing-to-file → no section.
  3. Implement: C and M in `src/core/footnotes.ts` returning `EditPlan` (two-place edit for M).
  4. Validate: unit tests pass.
  - Success: `[ref: PRD/AC F2.1–F2.4, F4.1–F4.5]`

- [ ] **T2.6 Phase Validation** `[activity: validate]`
  - All core tests green; zero `obsidian` imports under `src/core/`; lint + typecheck clean.
