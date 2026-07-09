---
title: "OCR reflow — reconstruct paragraphs and lists from hard-wrapped screen-capture text"
status: implemented
version: "1.0"
---

# Product Requirements Document

## Problem

Screen-capture OCR tools (e.g. TextSniper on macOS) transcribe slide text with a
**hard line break at the visual text-box width** and, crucially, **no blank line
between bullets or paragraphs**. Example (verbatim capture):

```
Recovery point objective (RPO) is used to specify the maximum amount of
time between the Last accessible backup and failure point. The RPO will help
in determining the amount of data that the business can manage to Lose in
the event of a failure.
Recovery time objective (RTO) is used to specify the maximum time a data
...
```

The existing `dewrap` step only joins soft-wrapped lines **inside a blank-line
separated paragraph block**. With no blank lines, `segmentBlocks()` treats the
whole capture as one run, so `dewrap` would collapse every distinct block into a
single line. There is no transform that recovers the intended block structure.

## Users & Journey

- **Note-taker capturing slides.** Runs TextSniper over a slide, pastes into a
  note, selects the text, runs **"Reflow wrapped text"** (or enables the toggle
  in Format selection / Paste and format). The hard-wrapped capture becomes
  clean paragraphs, and bulleted slides become a `- ` list — ready to edit.

## Must-have: the `reflow` transform

### F1 — Join soft-wrapped lines within a block

```gherkin
Scenario: hard-wrapped paragraph re-joined
  Given a paragraph broken across several hard-wrapped lines with no blank lines
  When reflow runs
  Then the lines are joined with single spaces into one paragraph
```

### F2 — Recover block boundaries without blank-line separators

```gherkin
Scenario: consecutive blocks split apart
  Given multiple blocks captured back-to-back with no blank line between them
  When reflow runs
  Then a new block starts at a bullet marker, after sentence-terminal
       punctuation (. ! ? :) at a line end, or after a clearly-short line
  And a period that falls mid-line does NOT start a new block
```

### F3 — Output mirrors input structure

```gherkin
Scenario: bulleted slide becomes a list, prose becomes paragraphs
  Given a capture whose lines start with bullet markers (•, ·, -, *, +)
  When reflow runs
  Then the output is a tidy "- " bullet list
  And a leading marker-less line (the slide title) stays a paragraph above it

Scenario: marker-less capture becomes paragraphs
  Given a capture with no bullet markers
  When reflow runs
  Then the output is paragraphs separated by a blank line
```

### F4 — Keep multi-sentence bullets intact

```gherkin
Scenario: a bullet containing two sentences is not split
  Given a marked list where one bullet spans two sentences
  When reflow runs
  Then the bullet stays a single list item (terminal punctuation is ignored
       inside a marked list; only markers start a new item)
```

### F5 — Preserve compound words broken at the wrap

```gherkin
Scenario: on-premises broken across a line
  Given a line ending in "on-" followed by "premises…"
  When reflow runs
  Then the result contains "on-premises" (hyphen kept, no inserted space)
  And it is never glued to "onpremises"
```

### F6 — Safety and idempotency

```gherkin
Scenario: protected content is untouched
  Given fenced code, indented code, frontmatter, headings, tables, or blockquotes
  When reflow runs
  Then those blocks are left byte-for-byte unchanged

Scenario: stable output
  Given already-reflowed text
  When reflow runs again
  Then it produces no edits
```

## MoSCoW

- **Must:** F1–F6 above.
- **Should:** opt-in delivery (default OFF), standalone command, recipe toggle.
- **Could:** slide-title → heading detection; OCR casing correction (`to Lose` →
  `to lose`); ordered-list renumbering inside reflow. *(All out of scope.)*
- **Won't:** guessing content the OCR truncated (e.g. a sentence cut off at
  "…or only partial").

## Known limitations (accepted)

- A multi-sentence **paragraph** whose interior sentence ends exactly at a wrap
  boundary (a full-width line ending in `.`) splits early via TERMINAL. Rare —
  natural wrapping fills lines maximally, so sentence ends seldom coincide.
- Genuine end-of-line **syllable** hyphenation is preserved as `com-plex` rather
  than glued; indistinguishable from a real compound without a dictionary.
- WIDTH calibration assumes natural (ragged-right) wrapping; artificially short
  interior lines can be read as deliberate breaks. Not observed in real captures.
