---
title: "Paste command UX — Implementation Plan"
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

- [x] Context priming section is complete
- [x] All implementation phases are defined with linked phase files
- [x] Dependencies between phases are clear (no circular dependencies)
- [x] Parallel work is properly tagged with `[parallel: true]`
- [x] Activity hints provided for specialist selection `[activity: type]`
- [x] Every phase references relevant SDD sections
- [x] Every test references PRD acceptance criteria
- [x] Integration & E2E tests defined in final phase
- [x] Project commands match actual project setup

---

## Output Schema

### PLAN Status Report

| Field | Value |
|-------|-------|
| specId | 005-paste-command-ux |
| title | Paste command UX — honest naming, paste-and-clean, diagnosability |
| status | DRAFT |
| phases | 4 |
| totalTasks | 8 |
| clarificationsRemaining | 0 |

---

## Specification Compliance Guidelines

Reference the SDD section in each task; run spec-compliance + code-quality review per task; verify all PRD acceptance criteria are met before marking a phase complete. Deviations require documented rationale and approval before proceeding.

## Metadata Reference

- `[parallel: true]` — tasks/phases that can run concurrently
- `[ref: document/section]` — links to specifications
- `[activity: type]` — activity hint for specialist agent selection

---

## Context Priming

*GATE: Read all files in this section before starting any implementation.*

**Specification**:
- `docs/XDD/specs/005-paste-command-ux/requirements.md` — PRD (5 features, 22 acceptance criteria)
- `docs/XDD/specs/005-paste-command-ux/solution.md` — SDD (applyTextCleanup helper, new command, logging, settings marker; ADR-25..28)
- `docs/XDD/ideas/2026-06-29-paste-command-ux.md` — source design + 10 resolved gap-review items

**Key Design Decisions**:
- **ADR-25**: Extract a pure `applyTextCleanup(doc, recipe, log?)` helper (the 7 cleanup steps); `fusedFormatNote` reuses it (byte-identical) and the new command runs it on the clipboard string.
- **ADR-26**: Fresh command ids — existing → `mason.pasteAndRunScripts`; new → `mason.pasteAndFormatText` (so stale hotkeys go inert, not surprising).
- **ADR-27**: "Paste and format" runs the 7-step subset (6 cleanup/list + normalize headings), skips cascade + footnotes, reuses the same recipe toggles.
- **ADR-28**: Debug-gated logging via an injected `StepLogger` (keeps core pure); never logs document/clipboard content.

**Implementation Context**:
```bash
Install: npm ci
Types:   npx tsc -noEmit -skipLibCheck
Lint:    npx eslint src/
Test:    npx vitest run
Build:   node esbuild.config.mjs            # prod: append "production"
```

---

## Implementation Phases

Tasks follow red-green-refactor: **Prime** → **Test** (red) → **Implement** (green) → **Validate**.

- [x] [Phase 1: Shared cleanup helper & fusedFormatNote refactor](phase-1.md)
- [x] [Phase 2: Paste commands (rename + new command + script logging)](phase-2.md)
- [x] [Phase 3: Settings marker](phase-3.md)
- [ ] [Phase 4: Documentation & integration verification](phase-4.md)

## Dependency Graph

```
Phase 1 (spine: applyTextCleanup helper + fusedFormatNote refactor + recipe logging)
   └──> Phase 2 (rename command + new "Paste and format" + script logging)   [depends on Phase 1 helper]
Phase 3 (settings marker)   [depends only on existing recipe — parallel with Phases 1-2]
   └──> Phase 4 (docs + integration & verification)   [depends on Phases 2 & 3]
```

Phase 1 is the spine — the helper must exist before the new command (Phase 2) can use it, and the refactor must stay byte-identical. Phase 3 (settings marker) touches only `settingsTab.ts` + the existing recipe, so it can proceed in parallel with Phases 1–2. Phase 4 (docs + verification) is last and needs the commands (Phase 2) and the marker (Phase 3) in place.

## Invariants (hold across all phases)

- **Byte-identity (CON-5):** `fusedFormatNote` / "Format selection" output is unchanged after the helper extraction. Gated by a regression test capturing pre-refactor output on dirty fixtures.
- **Core purity (CON-2):** `src/core/formatPipeline.ts` carries ZERO `obsidian` imports (enforced by `test/compliance.test.ts`).
- **Single undo (CON-2 plugin invariant):** "Paste and format" inserts via one `replaceSelection` → one transaction → one undo.
- **Isolation:** "Paste and format" never runs paste scripts; "Paste and run scripts" never runs the cleanup recipe; "Format selection" unchanged.
- **Privacy (CON-4):** debug logs contain step/script names, statuses, and counts only — never document or clipboard content.
- **Toggle source of truth:** both "Paste and format" and "Format selection" read the same `FormatSelectionRecipe`.

## Plan Verification

| Criterion | Status |
|-----------|--------|
| A developer can follow this plan without additional clarification | ✅ |
| Every task produces a verifiable deliverable | ✅ |
| All PRD acceptance criteria map to specific tasks | ✅ |
| All SDD components have implementation tasks | ✅ |
| Dependencies are explicit with no circular references | ✅ |
| Parallel opportunities are marked with `[parallel: true]` | ✅ |
| Each task has specification references `[ref: ...]` | ✅ |
| Project commands in Context Priming are accurate | ✅ |
| All phase files exist and are linked as `[Phase N: Title](phase-N.md)` | ✅ |
