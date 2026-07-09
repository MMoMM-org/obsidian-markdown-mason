---
title: "OCR reflow — solution design"
status: implemented
version: "1.0"
---

# Solution Design Document

## Overview

A single pure transform `reflow(ctx: OperationContext): EditPlan` in a new core
module `src/core/reflow.ts` (CON-2: no plugin imports). It is registered like the
other cleanup ops — one `RegistryEntry` feeding both a command and the `mason.*`
API — and participates in the `applyTextCleanup` pipeline behind an opt-in
recipe toggle.

## Algorithm

For the whole document:

1. `segmentBlocks(ctx.doc)` → identify **flowable** blocks (`paragraph`,
   `listItem`). Every other kind (fenced/indented code, frontmatter, headings,
   tables, blockquotes, thematic breaks, blanks) is a **barrier**: it bounds a
   run and is never modified.
2. Group maximal sequences of consecutive flowable blocks into a **run** (offset
   contiguous; any barrier or blank line ends it).
3. For each run, split its raw lines into **segments** and re-render.

### Segmentation (per run)

```
runHasMarker = any line starts with a bullet/ordered marker
maxWidth     = longest trimmed line length in the run

for each line k:
  k == 0            → new segment
  runHasMarker      → new segment iff line k has a marker      (LIST mode)
  else (PARAGRAPH mode):
      prev ends "letter-"        → continuation (wrapped word)
      prev ends . ! ? :          → new segment (TERMINAL)
      prev short enough that the
        first word of k would fit → new segment (WIDTH, ≤ 0.66·maxWidth)
      otherwise                  → continuation
```

Only line **ends** are inspected → a mid-line sentence end never false-splits.
LIST mode suppresses TERMINAL/WIDTH so multi-sentence bullets stay whole.

### Join & render

- Continuation join: single space, **except** when the accumulated text ends in
  `letter-` → join with no space, keeping the hyphen (`on-premises`).
- Bullet segment → `- ` + text (ordered markers preserved as `N. `).
- Paragraph segment → text.
- Separator: consecutive bullets → `\n` (tight list); any other adjacency →
  `\n\n` (blank line).

A run yields one `Edit { from, to, insert }` only when the rendered text differs.

## Wiring

| Layer | Change |
|-------|--------|
| `src/core/reflow.ts` | **new** — `reflow()` + helpers |
| `src/core/registry.ts` | entry `cleanup.reflow` → command **"Reflow wrapped text"**, API `mason.cleanup.reflow` |
| `src/core/formatSelection.ts` | `FormatSelectionRecipe.reflow`; `resolveFormatSelectionRecipe` defaults it **false** (only non-all-on key) |
| `src/core/types.ts` | `DEFAULT_SETTINGS.formatSelection.reflow = false` |
| `src/core/formatPipeline.ts` | `reflow` runs **first** in `applyTextCleanup`, gated by the toggle |
| `src/commands.ts` | `EMPTY_NOTICES["cleanup.reflow"]` |
| `src/ui/settingsTab.ts` | "Reflow wrapped text" toggle at the top of the Cleanup group |

## Design decisions (ADRs)

- **ADR-29 — opt-in / default OFF.** Reflow reshapes structure heuristically,
  unlike the conservative local cleanup steps. Making it the single opt-in key
  keeps existing Format selection / Paste and format behaviour unchanged.
- **ADR-30 — line-based, not block-based.** `segmentBlocks()` interleaves
  `listItem`/`paragraph` on OCR input, so reflow re-derives structure from raw
  run lines rather than the block grouping.
- **ADR-31 — self-calibrating WIDTH signal.** Threshold is a fraction of the
  run's own widest line (no fixed column). Kept at 0.66 so it fires only on
  clearly-short lines (titles, list tails), never on near-full soft wraps.
- **ADR-32 — reflow before dehyphenate/dewrap.** Reflow owns hyphen handling and
  re-segmentation; downstream steps become no-ops on reflowed regions.

## Testing

`test/core/reflow.test.ts` — 19 tests: paragraph mode (join, terminal split,
mid-line period, width/title), list mode (rebuild, multi-sentence bullet, title
above list, tidy list unchanged), hyphen handling, barriers/protected blocks,
degenerate + idempotency, and the **three real TextSniper captures** as fixtures
with programmatically-derived expected output. Full suite: 1633 pass.
