---
title: "Paste into a list — fit pasted content to the cursor's list context"
status: draft
version: "1.0"
---

# Product Requirements Document

## Problem

Mason's paste commands insert the cleaned clipboard text **verbatim at the
cursor**. The cursor's own line is never inspected. `runPasteAndFormatCommand`
(`src/main.ts`) hands the clipboard to `applyTextCleanup()` — which hard-codes
`cursor: 0` — and then calls `editor.replaceSelection(formatted)`.

That is fine when pasting into empty space. It produces broken structure when
the user is **inside a list**, which is one of the most common places to paste
in a note. Given a note whose cursor sits after `- `:

```
- |
```

and this clipboard (hard-wrapped prose, three paragraphs):

```
TOGAF is a framework for enterprise architecture that
provides an approach for designing, planning,
implementing, and governing an enterprise information
technology architecture.

TOGAF is a high-level approach to
design that puts pieces together to draw
a roadmap.

TOGAF is typically modeled at four
levels: Business, Data, Application, and
Technology (BDAT). It relies heavily on
modularization, standardization, and
proven technologies and products.
```

"Paste and format" today produces (verified against the current pipeline):

```
- TOGAF is a framework for enterprise architecture that provides an approach …

TOGAF is a high-level approach to design that puts pieces together to draw a roadmap.

TOGAF is typically modeled at four levels: Business, Data, Application, and …
```

`dewrap` did its job, but the **separating blank lines survive** and paragraphs
2..n get **no bullet marker** — the list is broken after the first item. The
user must then hand-edit every paragraph.

It gets worse when the clipboard already contains a list. With the same cursor
context and this clipboard:

```
The TOGAF standard is a proven enterprise architecture methodology … TOGAF has the following key features:

- It is a standard approach for helping with the acceptance, production, use, …
- It is based on an iterative process model that is supported by best practices …
- The TOGAF standard can be used for developing a broad range of different …
- The TOGAF Architecture Development Method (ADM) is used for developing …
```

the four bullets land at **column 0** — the same level as the item the cursor is
in — instead of one level **under** the lead-in sentence they belong to.

The plugin already solves the analogous problem for headings: `cascade()`
(`src/core/headings.ts`) reads the nearest heading above `ctx.cursor` and shifts
the pasted heading levels to fit. **There is no list equivalent.**

## Users & Journey

A note-taker builds an outline as a bullet list, opens `- `, copies a block of
prose (or prose + a sub-list) from a PDF, a web page or an OCR capture, and
invokes Mason's paste. They expect the pasted material to *join the outline*:
one bullet per paragraph at the level they are writing at, sub-lists nested
under the bullet that introduces them, and no stray blank lines splitting the
list apart.

Today they get a half-formatted paste and a manual clean-up pass — which is
exactly the work Mason exists to remove.

## Key insight (makes it feasible)

Everything needed is already in hand at paste time:

- `pasteContext()` (`src/sources/paste.ts`) already carries `doc` **and**
  `cursor`, so the cursor's line — its indent, its marker glyph, its ordinal —
  is readable without any new Obsidian API.
- `applyTextCleanup()` runs **before** insertion, so by the time the new step
  sees the clipboard, paragraphs are already dewrapped to one line each and
  bullet glyphs are already normalised to `-`. Re-segmenting the result with
  `segmentBlocks()` yields a clean, unambiguous block list.
- Mason inserts a **single string** in one `replaceSelection()` call, so
  restructuring is a pure string→string step with no editor gymnastics and one
  undo entry.

## Must-have: the `fitToList` step

### F1 — Detect the cursor's list context

Read the physical line containing `ctx.cursor` and match its leading list
prefix:

```
/^(\s*)([-*+]|\d+[.)])([ \t]+)(\[[ xX]\][ \t]+)?/
```

captured as `indent`, `marker`, `gap`, optional `task` (checkbox).

The context is a list context **only if** all hold:

- the line matches the pattern, and
- `ctx.cursor` lies at or after the end of the whole matched prefix (a cursor
  *before* or *inside* the marker is not a list context), and
- the enclosing block is not `fencedCode`, `indentedCode` or `frontmatter`.

Both an empty item (`- |`) and a filled one (`- Foo bar|`) count — per the
user's decision the step applies to **any list line**.

When no list context is detected the step is a no-op: the string is inserted
exactly as it is today. This is the single most important safety property.

### F2 — One item per top-level paragraph

Every top-level `paragraph` block of the pasted content becomes one list item at
the **context indent**, carrying the **context marker family**:

- bullet context (`-`, `*`, `+`) → the same glyph.
- ordered context (`3.`) → continuing ordinals `4.`, `5.`, … using the context's
  terminator (`.` or `)`).
- task context (`- [ ] `, `- [x] `) → the same glyph plus an **unchecked** `[ ] `
  box, so a pasted block into a task list stays a task list.

The blank blocks that separated those paragraphs are **dropped** — they are the
paragraph separators that must not survive inside a tight list.

### F3 — Nest a pasted list under the item that introduces it

A `listItem` run in the pasted content is emitted:

- **one level deeper** than the context, when a paragraph-item has already been
  emitted before it (the lead-in sentence is its parent — the TOGAF example B);
- **at the context level**, when the pasted content *starts* with a list (there
  is no lead-in paragraph to nest under; those items are siblings of the item
  the cursor is in).

Relative depth **inside** the pasted list is preserved: an item that was two
levels deep in the clipboard stays two levels below its own list's root.

Pasted list items keep **their own** markers (already normalised to `-` by
`normalizeBullets`, or their own ordinals) — only the paragraph-derived items in
F2 adopt the context marker.

### F4 — Continue the current line, don't restart it

The cursor already sits after a marker, so the **first** emitted line must be
inserted without its own indent and marker — it continues the line that is
already there. If the text before the cursor on that line is non-empty and does
not end in whitespace, a single space is inserted first (`- Foo` + `Bar` →
`- Foo Bar`, never `- FooBar`).

The inserted string carries **no trailing newline**, so the caret lands at the
end of the last pasted item.

### F5 — Indentation unit

One indent level is a literal string, resolved in this order:

1. the indent delta actually used by the **note** near the cursor (the first
   line in the enclosing list block that is indented deeper than the context
   item, whitespace taken verbatim);
2. failing that, the indent unit found in the **pasted content's** own nested
   list;
3. failing that, a single tab (`\t`) — Obsidian's own default.

This keeps the pasted material consistent with whatever the vault already uses
without reading unsupported Obsidian config APIs.

### F6 — Safety, robustness, idempotency

- Block kinds other than `paragraph`, `listItem` and `blank` (fenced code,
  tables, block quotes, headings, thematic breaks) are emitted **verbatim** as
  continuation content of the current item, indented to that item's content
  column. Their inner lines are never re-wrapped or re-marked.
- No list context → byte-for-byte the current behaviour.
- Empty clipboard / whitespace-only → unchanged current behaviour (the existing
  empty-clipboard guard fires first).
- The step never edits the note outside the inserted range: it is a pure
  `(text, doc, cursor) → text` function; insertion stays one `replaceSelection`.

### F7 — Where it runs

- **"Paste and format"** (`mason.pasteAndFormatText`): after `applyTextCleanup`,
  before insertion. Primary path.
- **"Paste and run scripts"** (`mason.pasteAndRunScripts`), **no-match path
  only**: the "no recognized format — pasted as-is" branch also fits the raw
  clipboard to the list context (structure only — no text cleanup, that command
  does not clean up). The **script-failure** `rawFallback` path is deliberately
  left as a plain verbatim paste: it is the safe-degradation contract and must
  stay dumb.
- **Not** in "Format selection" — that command has no clipboard and no insertion
  point.

### F8 — Setting

A new top-level `MasonSettings.pasteListContext: boolean`, **default `true`**,
with a toggle in the settings tab. It is deliberately **not** a
`FormatSelectionRecipe` key: the recipe configures the *Format selection*
command's text-cleanup steps, whereas this is a paste-time **context
adaptation** (the sibling of `cascade`, not of `dewrap`).

## Acceptance criteria

```
Given the cursor is at "- |" at indent 0
  And the clipboard holds three blank-line-separated hard-wrapped paragraphs
 When the user runs "Paste and format"
 Then the note shows three "- " items at indent 0, each one dewrapped paragraph
  And no blank line remains between them

Given the cursor is at "- |" at indent 0
  And the clipboard holds a lead-in paragraph, a blank line, then four "- " items
 When the user runs "Paste and format"
 Then the lead-in paragraph becomes the text of the cursor's item
  And the four items are emitted one indent level deeper

Given the cursor is at "3. |" in an ordered list
 When the user pastes two paragraphs
 Then they are emitted as "3. <first>" and "4. <second>"

Given the cursor is at "- [ ] |" in a task list
 When the user pastes two paragraphs
 Then the second is emitted as "- [ ] <second>" (unchecked)

Given the cursor is at "- Foo|"
 When the user pastes "Bar"
 Then the line reads "- Foo Bar"

Given the cursor is in an ordinary paragraph (no list marker)
 When the user pastes anything
 Then the result is byte-for-byte what the current build produces

Given pasteListContext is off
 When the user pastes into a list line
 Then the result is byte-for-byte what the current build produces
```

## MoSCoW

- **Must:** F1–F8 for bullet, ordered and task contexts.
- **Should:** relative-depth preservation of multi-level pasted lists (F3);
  the note-derived indent unit (F5.1).
- **Could:** a standalone "Fit selection to list context" command; honouring a
  blockquote context (`> - `). *(Out of scope for v1.)*
- **Won't:** re-flowing content that is not at the cursor; changing the list the
  user is in (existing items are never renumbered or re-indented — `fitToList`
  only produces the inserted string).

## Known limitations (accepted)

- Text **after** the cursor on the same line stays put and therefore ends up
  appended to the last pasted item. That is standard editor paste behaviour and
  is not special-cased.
- An ordered context is continued by simple increment; the surrounding list is
  not renumbered afterwards, so pasting into the middle of an ordered list can
  leave duplicate ordinals below the insertion point. Running "Format selection"
  (`normalizeOrdered`) fixes it; auto-renumbering the rest of the note is out of
  scope because it would edit outside the inserted range.
- Lazy continuation lines (a marker-less line that Markdown still folds into the
  preceding item) are classified `paragraph` by `segmentBlocks()` and therefore
  become their own item. Post-`dewrap` this is the desired reading in practice;
  it is not separately detected.
