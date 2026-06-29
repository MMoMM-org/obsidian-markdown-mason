---
title: "Text format transforms — Implementation Plan"
status: pending
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
| specId | 004-text-format-transforms |
| title | Text format transforms — six markdown-aware cleanup and list transforms |
| phases | 6 |
| tasks | 14 |
| status | DRAFT |

---

## Overview

Extend Mason's **"Format selection"** composite with six new markdown-aware transforms
that eliminate pasted-text artifacts: dewrap, dehyphenate, decomposeLigatures,
tidyWhitespace, normalizeBullets, normalizeOrdered. The recipe grows from 5 to 11 flat
boolean keys (all default-on). Three new pure core modules deliver the transforms; the
existing fused pipeline and registry absorb them additively. Behavior-preserving by
default; individually commandable and API-accessible under ADR-19 isolation.

See `../requirements.md` (PRD) and `../solution.md` (SDD). Key decisions: ADR-20
(line-based block segmenter — no parser dependency), ADR-21 (step order), ADR-22 (flat
keys + two family modules), ADR-23 (setHeading sub-groups), ADR-24 (full built-in
exposure under ADR-19 isolation).

## Context Priming

Read before starting any phase:
- `../solution.md` — full design (block segmenter, six transforms, extended recipe,
  extended `fusedFormatNote`, registry additions, settings UI, ADR-20 through ADR-24).
- `../requirements.md` — PRD Features 1-7, acceptance criteria (38 total).
- Code: `src/core/formatSelection.ts` (FormatSelectionRecipe + resolveFormatSelectionRecipe),
  `src/core/types.ts` (MasonSettings, DEFAULT_SETTINGS), `src/commands.ts` (fusedFormatNote,
  "Tidy footnotes" command), `src/core/registry.ts` (RegistryEntry, buildEntries, MasonApi),
  `src/core/applyToString.ts` (offset model, RTL application),
  `src/ui/settingsTab.ts` (_renderFormatSelectionSection),
  `test/compliance.test.ts` (CON-2 purity sweep).

## Project Commands

```bash
Install: npm ci
Types:   npx tsc -noEmit -skipLibCheck
Lint:    npx eslint src/
Test:    npx vitest run
Build:   node esbuild.config.mjs            # prod: append "production"
```

## Phases

- [x] [Phase 1: Pure core foundations](phase-1.md)
- [x] [Phase 2: Cleanup transforms](phase-2.md)
- [x] [Phase 3: List transforms](phase-3.md)
- [x] [Phase 4: Command wiring, registry & API](phase-4.md)
- [x] [Phase 5: Settings UI](phase-5.md)
- [ ] [Phase 6: Integration & verification](phase-6.md)

## Dependency Graph

```
Phase 1 (spine: markdownBlocks.ts, extended recipe + resolver, extended DEFAULT_SETTINGS)
   ├──> Phase 2 (cleanup transforms: dehyphenate, dewrap, tidyWhitespace, decomposeLigatures)   [parallel with Phase 3]
   ├──> Phase 3 (list transforms: normalizeBullets, normalizeOrdered)                           [parallel with Phase 2]
   └──> Phase 5 (settings UI: 11 toggles + setHeading sub-groups)                              [parallel with Phase 4]
                 └──> Phase 4 (command wiring + registry + API)                    [depends on Phases 2 & 3]
                               └──> Phase 6 (integration & verification)           [depends on Phases 4 & 5]
```

Phase 1 is the spine. Phases 2 and 3 both depend only on Phase 1 and can proceed in
parallel. Phase 5 depends only on Phase 1 (reads the extended recipe type) and can
proceed in parallel with Phase 4. Phase 4 requires Phases 2 and 3 complete first.
Phase 6 is last, requiring both Phases 4 and 5.

## Invariants (hold across all phases)

- **All-on byte-identity (CON-4):** with all 11 toggles on, "Format selection" on a note
  containing no pasted-text artifacts produces `[]` — byte-identical to a pre-004 release.
  The six new transforms each return `[]` when their trigger conditions are absent.
- **Single atomic edit (CON-1):** any subset of enabled steps yields at most one `Edit`
  (one CM6 transaction, one undo step). `fusedFormatNote` returns `EditPlan` of length 0 or 1.
- **Core purity (CON-2):** `src/core/markdownBlocks.ts`, `src/core/cleanup.ts`, and
  `src/core/lists.ts` carry ZERO `obsidian` imports. Enforced statically by `test/compliance.test.ts`.
- **Scope isolation (ADR-19):** only `fusedFormatNote` reads the recipe. Individual
  commands, `mason.*` API methods, "Tidy footnotes", and the paste flow are unaffected.
- **Idempotency:** every transform applied to its own output returns `[]`. Verified by
  automated two-pass tests for each transform individually and for the composite.
- **Markdown-structure preservation:** no transform corrupts, deletes, or reorders fenced
  code blocks, indented code, headings, thematic breaks, blockquotes, list items, table
  rows, or YAML frontmatter.
- **Existing behavior (Must Preserve):** "Tidy footnotes" command behavior; all five
  spec-003 recipe steps and their relative order; every individual built-in command;
  `mason.*` API contract; `tidyFootnotes` signature.
