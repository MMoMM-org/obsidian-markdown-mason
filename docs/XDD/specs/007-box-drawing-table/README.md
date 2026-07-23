# Specification: 007-box-drawing-table

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-07-23 |
| **Current Phase** | Implemented (unmerged; manual Obsidian smoke pending) |
| **Last Updated** | 2026-07-23 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | 1 must-have transform; reference fixture = a verbatim Claude-Code/WezTerm capture |
| solution.md | completed | `boxTable()` core module + registry entry + recipe toggle (default ON) |
| code-token-script.draft.cjs | draft | companion catalog-script skizze for the *sibling* concern (backticking code tokens) — routed to the vetted-repo script library, NOT into core |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-23 | Add a `boxTable` transform | Terminal tables (Claude Code, psql, docker, TUIs) paste as border-glyph prose, not Markdown tables; on naive paste Obsidian even collapses them to one line. No existing transform recovers the grid. |
| 2026-07-23 | Feasible because Mason sees the raw clipboard | Paste interception runs before Obsidian collapses interior newlines, so the intact multi-line grid is available to reconstruct. |
| 2026-07-23 | Default ON, unlike `reflow` | A full frame BORDER row is a near-zero-false-positive signal and conversion is lossless for well-formed grids, so it fits the conservative always-on cleanup bucket rather than opt-in. |
| 2026-07-23 | Bail on ragged grids | If content rows disagree on column count the block is likely mis-detected; leaving it untouched avoids silent data loss. |
| 2026-07-23 | Runs first in the cleanup pipeline | A drawn table is a `paragraph` run until converted; converting first turns it into a `table` barrier so reflow/dewrap/dehyphenate leave it alone. |
| 2026-07-23 | Code-token backticking is a script, not this transform | Backticking `render.py:102-110` / `detail.candidate_mocs` / `up:: [[MOC]]` is heuristic with real prose false-positives; it belongs in an opt-in catalog script (aggressive-but-removable), never a default. `boxTable` rebuilds only the grid. |
| 2026-07-23 | Split on the table's own separator glyph, not the whole class | Splitting content rows on `[│┃║\|]` would treat a literal ASCII `\|` inside a │-delimited cell as a column boundary. The transform detects the dominant separator per table and splits on that single character; a stray `\|` is kept as content and escaped in the output. |
| 2026-07-23 | Implementation complete | `src/core/boxTable.ts` + registry entry `cleanup.boxTable` (command "Convert box-drawing table to Markdown", API `mason.cleanup.boxTable`) + `FormatSelectionRecipe.boxTable` (default ON) + pipeline wiring (runs first) + settings toggle. 12 new tests incl. the real WezTerm capture; full suite (1645) green; lint clean (added `CLI`/`Markdown` to the sentence-case allowlist). Not yet merged/released; manual Obsidian smoke still pending. |

## Context

Extends the spec-003/004 Format selection recipe and the spec-005 `applyTextCleanup`
pipeline; sits beside spec-006 `reflow` as a second "reconstruct structure from
terminal/OCR paste" transform. Reference input is a real Claude-Code table copied
from WezTerm, preserved verbatim in `requirements.md` and planned as the primary
test fixture.

The **code-token backticking** concern surfaced in the same discussion is
intentionally split out: it is a heuristic that must stay opt-in, so it is drafted
as a catalog script (`code-token-script.draft.cjs`) destined for the
`MMoMM-org/markdown-mason-scripts` repo — not implemented in core.

---
*This file is managed by the xdd-meta skill.*
