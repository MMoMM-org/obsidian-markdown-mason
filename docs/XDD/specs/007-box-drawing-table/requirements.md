---
title: "Box-drawing table — convert Unicode/ASCII drawn tables into Markdown tables"
status: implemented
version: "1.0"
---

# Product Requirements Document

## Problem

CLI tools (Claude Code, `psql`, `docker`, many TUIs) render tables with
**box-drawing characters** — `┌ ┬ ┐ ├ ┼ ┤ └ ┴ ┘ ─ │` and their heavy/double
variants, or the ASCII `+ - |` family. When such a table is copied into Obsidian
it is not a Markdown table: it is prose lines full of border glyphs. Worse, on a
naive paste Obsidian collapses the interior line breaks, so the whole table
becomes a single unreadable line while the border glyphs survive.

Verbatim example (copied from Claude Code in WezTerm — the reference fixture):

```
┌─────────────┬──────────────────────────────────────┬──────────────────────┐
│  Artefakt   │                 Form                  │     Wer liest sie    │
├─────────────┼──────────────────────────────────────┼──────────────────────┤
│ Report      │ Der Prosa-Satz „No candidate MOC …"  │ Nur du (Human …)     │
│ (.md)       │ — gerendert in render.py:102-110 …   │                      │
├─────────────┼──────────────────────────────────────┼──────────────────────┤
│ Wire        │ detail.candidate_mocs: [] — roh      │ Pass-2-Parser … und  │
│ (.json)     │                                      │ Hashi/Tomo-Editor    │
└─────────────┴──────────────────────────────────────┴──────────────────────┘
```

No existing transform recovers this. `reflow`/`dewrap` operate on flowable
paragraph runs and would mangle the border rows; nothing understands the column
grid.

## Users & Journey

- **Anyone pasting terminal output.** Copies a drawn table from a terminal,
  pastes it into a note, and it arrives as a clean Markdown table — header row,
  `---` delimiter, one row per logical record — with wrapped cells re-joined.
  Delivered as a standalone command ("Convert box-drawing table to Markdown")
  and a Format selection / Paste and format recipe toggle.

## Key insight (makes it feasible)

Mason intercepts the **raw clipboard** at paste time, *before* Obsidian collapses
the interior newlines. The transform therefore sees the intact multi-line grid
and can reconstruct it. (Once a table has already been pasted-and-collapsed to a
single line, reconstruction is out of scope — see Won't.)

## Must-have: the `boxTable` transform

### F1 — Detect a drawn table block

```gherkin
Scenario: a drawn table is recognised
  Given a contiguous block of lines that contains at least one BORDER row
        (a line made up only of box-drawing/ASCII-frame glyphs and spaces)
        and one or more CONTENT rows delimited by vertical bars
  When boxTable runs
  Then that block is treated as a table to convert

Scenario: prose is left alone
  Given ordinary text that merely contains a "│" or "|" character but no border row
  When boxTable runs
  Then nothing is changed
```

### F2 — Reconstruct the column grid

```gherkin
Scenario: cells are split on the column separators
  Given a content row "│ a │ b │ c │"
  When boxTable runs
  Then it yields three trimmed cells: "a", "b", "c"
```

### F3 — Re-join wrapped cells within one logical row

```gherkin
Scenario: a cell wrapped across physical rows is joined
  Given a logical row (between two separator borders) whose cells span
        several physical "│ … │" lines
  When boxTable runs
  Then each column's non-empty fragments are joined with single spaces
        into one cell value
```

### F4 — Emit a valid Markdown table

```gherkin
Scenario: header, delimiter, rows
  Given a detected table with N columns
  When boxTable runs
  Then the first logical row becomes the header
  And a "| --- | … |" delimiter row (N columns, left-aligned) follows
  And each remaining logical row becomes one "| … |" line
  And a literal "|" inside any cell is escaped as "\|"
```

### F5 — Safety, robustness, idempotency

```gherkin
Scenario: protected content is untouched
  Given box-drawing characters inside fenced or indented code, or frontmatter
  When boxTable runs
  Then those blocks are left byte-for-byte unchanged

Scenario: ragged grid is not corrupted
  Given a table where a content row splits into a different column count
        than the header
  When boxTable runs
  Then that table is left unchanged (bail rather than mis-align)

Scenario: stable output
  Given an already-converted Markdown table (no border glyphs)
  When boxTable runs again
  Then it produces no edits
```

## MoSCoW

- **Must:** F1–F5 for the light Unicode set (`┌┬┐├┼┤└┴┘─│`).
- **Should:** heavy/double variants (`┏…┓ ╔…╗ ┃ ═`) and the ASCII `+ - |` frame;
  standalone command; recipe toggle; default **ON** (detection is unambiguous, so
  unlike `reflow` it need not be opt-in — see solution ADR).
- **Could:** alignment inference from `:` markers if a border row carries them;
  right-padding-based alignment guesses. *(Out of scope for v1 — default left.)*
- **Won't:** reconstruct a table that Obsidian has already collapsed to a single
  physical line (interior newlines are gone); nested/spanned cells (`colspan`).

## Known limitations (accepted)

- A cell whose intended content legitimately contains a newline (e.g. a bullet
  list inside a cell) is flattened to one space-joined line — Markdown tables
  cannot express multi-line cells without `<br>`; not attempted in v1.
- Column detection relies on aligned `│` separators; a table whose separators do
  not vertically align (hand-edited) may split unevenly and will be bailed on
  under F5 rather than converted.
