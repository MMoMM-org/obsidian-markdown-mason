# Specification: 006-ocr-reflow

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-07-09 |
| **Current Phase** | Implemented (smoke-tested, unmerged) |
| **Last Updated** | 2026-07-09 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | 1 must-have transform, calibrated against 3 real TextSniper captures |
| solution.md | completed | `reflow()` core module + registry entry + opt-in recipe toggle (default OFF) |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-09 | Add a `reflow` transform | Screen-capture OCR (TextSniper) emits slide text with hard line breaks at the visual box width and **no blank line** between blocks. `dewrap` cannot help — `segmentBlocks()` sees one contiguous run, so `dewrap` would merge every block into a single line. |
| 2026-07-09 | Line-based, not paragraph-block-based | `segmentBlocks()` classifies `•`/`-` lines as `listItem` and their marker-less continuations as `paragraph`, interleaving them. `reflow` therefore re-derives structure from the raw lines of a contiguous flowable run. |
| 2026-07-09 | Three boundary signals + mode switch | MARKER (line starts with a bullet) / TERMINAL (previous line ends `.!?:`) / WIDTH (previous line was clearly short → deliberate break, self-calibrated against the run's widest line). If **any** marker is present the run is a LIST (marker-only boundaries, keeps multi-sentence bullets intact); otherwise PARAGRAPH mode uses TERMINAL + WIDTH. Only line *ends* are inspected, so a sentence ending mid-line never false-splits. |
| 2026-07-09 | Output mirrors input | Marker run → tidy `- ` bullet list; marker-less run → blank-line-separated paragraphs; a leading marker-less line (slide title) stays its own paragraph above the list. |
| 2026-07-09 | Trailing hyphen = continuation; keep the hyphen | A line ending `letter-` is a wrapped word → always joined without a space, keeping the hyphen (`on-\npremises` → `on-premises`). Safe for compounds, the common case in slides; genuine syllable hyphenation stays visible as `com-plex` rather than being silently glued. |
| 2026-07-09 | Default OFF (opt-in) | The signals are heuristic and reshape structure more aggressively than the other conservative cleanup steps. `reflow` is the only recipe key that defaults false. Primary entry point: the standalone **"Reflow wrapped text"** command; also selectable in the Format selection / Paste and format recipe. |
| 2026-07-09 | Runs first in the cleanup pipeline | Placed before `dehyphenate`/`dewrap` so its re-segmentation and hyphen handling own the flowable text; the later steps become no-ops on reflowed regions. |
| 2026-07-09 | Implementation complete | `src/core/reflow.ts` + registry entry `cleanup.reflow` (command "Reflow wrapped text", API `mason.cleanup.reflow`) + `FormatSelectionRecipe.reflow` + pipeline wiring + settings toggle. 19 new tests incl. the 3 real captures; full suite (1633) green; lint + production build clean. Not yet merged/released. |
| 2026-07-09 | Manual smoke passed | Verified in the test vault: standalone "Reflow wrapped text" command reflows a pasted OCR capture (title + `•` bullets) into a title paragraph + tidy `- ` list. |

## Context

Extends the spec-003/004 Format selection recipe and the spec-005 `applyTextCleanup` pipeline. The user captures slide bullet points with TextSniper (macOS OCR); the raw text has hard wraps and no blank-line separators, which the existing transforms cannot recover. `reflow` reconstructs paragraphs and bullet lists from that input. Calibrated against three real captures preserved verbatim as test fixtures (`test/core/reflow.test.ts`).

---
*This file is managed by the xdd-meta skill.*
