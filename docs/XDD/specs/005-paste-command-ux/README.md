# Specification: 005-paste-command-ux

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-06-29 |
| **Current Phase** | Ready |
| **Last Updated** | 2026-06-29 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | 5 must-have features, 22 Gherkin acceptance criteria, 0 clarifications |
| solution.md | completed | ADR-25..28 (all confirmed); applyTextCleanup helper + new command + logging + settings marker |
| plan/ | completed | 4 phases, 8 tasks; alignment-checked (all modify-targets exist; new files absent; 5 old-id test refs flagged for migration) |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-29 | Spec 005 scaffolded from brainstorm idea | Source: `docs/XDD/ideas/2026-06-29-paste-command-ux.md`. Surfaced during spec-004 smoke testing: the "Paste and format" command only runs paste-scripts, not the cleanup recipe — confusing. |
| 2026-06-29 | Naming locked | Existing paste-script command → "Paste and run scripts" (id `mason.pasteAndRunScripts`); NEW command → "Paste and format" (fresh id `mason.pasteAndFormatText`) = paste + 7-step cleanup recipe scoped to the pasted text. |
| 2026-06-29 | "Paste and format" runs 7 of 11 recipe steps | 6 cleanup/list transforms + Normalize headings; skips cascade + 3 footnote steps (document-contextual). Respects the same FormatSelectionRecipe toggles. |
| 2026-06-29 | Shared pure helper | Extract `applyTextCleanup(doc, recipe)` (pure, CON-2) for the 7 steps; `fusedFormatNote` reuses it (byte-identical) then adds cascade + footnotes. |
| 2026-06-29 | Diagnostic logging (debug-gated) on two paths | 4a paste-script `canHandle` results; 4b recipe pipeline per-step skipped/edit-count (Format selection logs nothing today). Never log doc/clipboard content. |
| 2026-06-29 | Settings marker | Mark the 4 toggles "Paste and format" does NOT run (cascade + 3 footnote toggles) in the settings UI; notice stays simple, per-step detail goes to debug log. |

## Context

Builds directly on spec 004 (text-format-transforms, merged to main via #19). The cleanup recipe (`fusedFormatNote` / `FormatSelectionRecipe`, 11 toggles) and the paste-script pipeline (`src/main.ts`) already exist. This spec disambiguates the paste commands, adds a true "paste and clean up" command, improves diagnosability, and documents the distinction. Full validated design + 10 resolved gap-review items in the source idea file.

---
*This file is managed by the xdd-meta skill.*
