---
title: "Format selection recipe — Implementation Plan"
status: complete
version: "1.0"
---

# Implementation Plan

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All `[NEEDS CLARIFICATION: ...]` markers have been addressed
- [x] All specification file paths are correct and exist
- [x] Each phase follows TDD: Prime → Test → Implement → Validate
- [x] Every task has verifiable success criteria
- [x] A developer could follow this plan independently

### QUALITY CHECKS (Should Pass)

- [x] All implementation phases are defined with linked phase files
- [x] Dependencies between phases are clear (no circular dependencies)
- [x] Parallel work is tagged with `[parallel: true]`
- [x] Activity hints provided for specialist selection `[activity: type]`
- [x] Every phase references relevant SDD sections
- [x] Every test references PRD acceptance criteria
- [x] Integration & verification defined in the final phase
- [x] Project commands match actual project setup

---

## Output Schema

### PLAN Status Report

| Field | Value |
|-------|-------|
| specId | 003-format-selection-recipe |
| title | Format selection recipe — configurable per-step toggles |
| phases | 4 |
| tasks | 7 |
| status | DRAFT |

---

## Overview

Make Mason's **"Format selection"** composite command a configurable recipe via 5
per-built-in-step toggles (cascade, normalize, fromCitations, identity, move),
default all-on. Only that command consults the toggles. Additive, behavior-preserving.

See `../requirements.md` (PRD) and `../solution.md` (SDD). Key decisions: ADR-18
(compositional paste — no auto-pipeline/veto) and ADR-19 (Format selection is the
only settings-driven composite).

## Context Priming

Read before starting any phase:
- `../solution.md` — full design (settings model, parameterized `tidyFootnotes`,
  `fusedFormatNote` gating, UI, ADR-18/19).
- `../requirements.md` — acceptance criteria.
- Code: `src/commands.ts` (`fusedFormatNote` 276, Tidy footnotes 351),
  `src/core/noteFootnotes.ts` (`tidyFootnotes` 592, `diffToEditPlan`),
  `src/core/types.ts` (`MasonSettings`, `DEFAULT_SETTINGS`),
  `src/ui/settingsTab.ts` (`_render*Section`, `_renderSegmentNav`, `addToggle`).

## Project Commands

```bash
Install: npm ci
Types:   npx tsc -noEmit -skipLibCheck
Lint:    npx eslint src/
Test:    npx vitest run
Build:   node esbuild.config.mjs            # prod: append "production"
```

## Phases

- [ ] [Phase 1: Pure core foundations](phase-1.md)
- [ ] [Phase 2: Command wiring](phase-2.md)
- [ ] [Phase 3: Settings UI](phase-3.md)
- [ ] [Phase 4: Integration & verification](phase-4.md)

## Dependency Graph

```
Phase 1 (pure core: recipe type + resolver, settings field, parameterized tidyFootnotes)
   ├──> Phase 2 (fusedFormatNote wiring + behavior/isolation tests)   [parallel with Phase 3]
   └──> Phase 3 (settings UI section)                                 [parallel with Phase 2]
                 └──> Phase 4 (integration & verification)
```

Phase 1 is the spine. Phases 2 and 3 both depend only on Phase 1 and can proceed in
parallel. Phase 4 is last.

## Invariants (hold across all phases)

- **Back-compat default:** `tidyFootnotes(ctx)` with no include arg behaves exactly as
  today. The "Tidy footnotes" command and any other existing callers are NOT changed.
- **Behavior preservation:** with all 5 steps on, "Format selection" output is
  byte-identical to the pre-feature release.
- **Single atomic edit:** every recipe (any subset) yields at most one `Edit`.
- **Core purity (CON-2):** `src/core/formatSelection.ts` and the widened
  `tidyFootnotes` import nothing from `obsidian`.
- **Scope isolation (ADR-19):** only `fusedFormatNote` reads the recipe.
