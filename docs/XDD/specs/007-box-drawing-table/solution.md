---
title: "Box-drawing table — solution design"
status: draft
version: "0.1"
---

# Solution Design Document

## Overview

A single pure transform `boxTable(ctx: OperationContext): EditPlan` in a new core
module `src/core/boxTable.ts` (CON-2: no plugin imports). Registered like the
other cleanup ops — one `RegistryEntry` feeding both a command and the `mason.*`
API — and wired into the `applyTextCleanup` pipeline behind a recipe toggle
(default **ON**; see ADR-33).

## Detection & grammar

Work over `ctx.doc`. Use `segmentBlocks()` to find candidate regions and to keep
code/frontmatter/existing-table blocks as **barriers** (never touched). A drawn
table shows up as one `paragraph` block (it has no interior blank lines).

Classify each physical line of a candidate block:

- **BORDER** — after trimming, the line consists *only* of frame glyphs and
  spaces. Frame glyphs = the corner/junction/horizontal set
  `┌┬┐├┼┤└┴┘─┏┳┓┣╋┫┗┻┛━╔╦╗╠╬╣╚╩╝═` plus ASCII `+` and `-`.
- **CONTENT** — the line contains at least one column separator (`│ ┃ ║ |`) and
  some non-frame text.

A block is a table iff it has **≥1 BORDER row and ≥1 CONTENT row**, and the first
non-blank line is a BORDER (top rule) — this is the near-zero-false-positive
signal (ordinary prose never contains a full `├───┼───┤` rule).

## Algorithm

1. **Column split.** For each CONTENT row, strip a leading/trailing separator,
   then split on the separator character. Trim each cell. `columnCount` = the
   cell count of the header row (first CONTENT row).
2. **Bail on ragged.** If any CONTENT row splits into a different non-empty count
   than `columnCount`, abandon this table (return no edit for it) — F5 safety.
3. **Group logical rows.** BORDER rows of the `├…┼…┤` family (interior rules)
   separate logical rows; the top/bottom rules bound the table. Consecutive
   CONTENT rows with no interior rule between them belong to the **same** logical
   row (wrapped cell) → per column, join their non-empty fragments with a single
   space. (Optional: reuse reflow's compound-hyphen guard so `on-`/`premises`
   joins without a space; deferred unless a fixture needs it.)
4. **Render.** Header = first logical row. Emit:
   ```
   | h1 | h2 | … |
   | --- | --- | … |
   | r1c1 | r1c2 | … |
   ```
   Escape `|` → `\|` in every cell. Left-align only (v1).
5. One `Edit { from, to, insert }` replacing the whole detected block, emitted
   only when the rendered table differs from the source.

Idempotency is automatic: the output has no frame glyphs, so a second pass finds
no BORDER row and does nothing. It is also recognised as a `table` block by
`segmentBlocks()`, so any later pipeline step treats it as a barrier.

## Pipeline placement

`boxTable` must run **before** `reflow`/`dewrap`/`dehyphenate`. Those operate on
`paragraph`/`listItem` runs, and a not-yet-converted drawn table is classified as
`paragraph` — they would corrupt the border rows first. Running `boxTable` first
turns the block into a real `table`, which every subsequent step skips.

## Wiring

| Layer | Change |
|-------|--------|
| `src/core/boxTable.ts` | **new** — `boxTable()` + helpers |
| `src/core/registry.ts` | entry `cleanup.boxTable` → command **"Convert box-drawing table to Markdown"**, API `mason.cleanup.boxTable` |
| `src/core/formatSelection.ts` | `FormatSelectionRecipe.boxTable`; resolve default **true** |
| `src/core/types.ts` | `DEFAULT_SETTINGS.formatSelection.boxTable = true` |
| `src/core/formatPipeline.ts` | `boxTable` runs **first** in `applyTextCleanup`, gated by the toggle |
| `src/commands.ts` | `EMPTY_NOTICES["cleanup.boxTable"]` |
| `src/ui/settingsTab.ts` | "Convert box-drawing table" toggle in the Cleanup group |

## Design decisions (ADRs)

- **ADR-33 — default ON (unlike reflow).** The detection signal (a full frame
  BORDER row) has effectively zero false positives in prose, and the transform
  is lossless for well-formed grids. So it belongs with the conservative
  always-on cleanup steps, not with opt-in `reflow` (which reshapes ambiguous
  prose). The bail-on-ragged rule (F5) keeps it safe on malformed input.
- **ADR-34 — bail rather than best-effort on ragged grids.** A drawn table whose
  rows disagree on column count is more likely mis-detected than genuinely
  tabular; converting it risks silent data loss. Leaving it byte-for-byte is the
  safe default.
- **ADR-35 — run before reflow/dewrap.** A drawn table is a `paragraph` run until
  converted; converting first makes it a `table` barrier for all later steps.
- **ADR-36 — left-align only in v1.** Box frames don't encode alignment; guessing
  from padding is unreliable. Emit `---` and let the user adjust.

## Sibling concern (deliberately NOT in this transform)

Backticking "code-ish" tokens in the prose cells (`render.py:102-110`,
`detail.candidate_mocs`, `up:: [[MOC]]`) is a **heuristic** with real
false-positive risk in natural text. Per the scripts-vs-core split it is routed to
an **opt-in catalog script**, not a default transform — draft in
`code-token-script.draft.cjs` alongside this spec. `boxTable` only rebuilds the
grid; it never rewrites cell text.

## Testing (planned)

`test/core/boxTable.test.ts` — the verbatim Claude-Code/WezTerm capture as the
primary fixture, plus: simple 2×2 light table, wrapped-cell join, heavy/double
variants, ASCII `+ - |` frame, ragged-bail, pipe-escaping, code-fence barrier,
and idempotency (converted table unchanged on re-run).
