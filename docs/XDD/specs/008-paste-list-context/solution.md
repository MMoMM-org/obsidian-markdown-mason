---
title: "Paste into a list — solution design"
status: draft
version: "1.0"
---

# Solution Design Document

## Overview

A new pure core module `src/core/fitToList.ts` (CON-2: no obsidian imports)
exposing one entry point:

```ts
fitPasteToList(text: string, doc: string, cursor: number): string
```

`text` is the already-cleaned clipboard string, `doc`/`cursor` come straight from
`OperationContext`. It returns `text` **unchanged** when the cursor is not in a
list line, so every non-list paste is byte-identical to today.

Unlike the `applyTextCleanup` steps this is **not** an `(ctx) => EditPlan`
transform: it does not edit the document, it reshapes the string that is about
to be inserted. It is the paste-time sibling of `cascade()` — context in, one
insertion out — and therefore gets its own top-level setting rather than a
`FormatSelectionRecipe` key (ADR-37).

## Public surface

```ts
export interface ListContext {
	/** Leading whitespace of the cursor's line, verbatim. */
	indent: string;
	/** "-" | "*" | "+" for bullets; the digits are carried separately for ordered. */
	glyph: string;
	/** Non-null for an ordered context: the ordinal on the cursor's line. */
	ordinal: number | null;
	/** "." or ")" for an ordered context, else null. */
	terminator: "." | ")" | null;
	/** True when the cursor's item carries a "[ ]" / "[x]" checkbox. */
	task: boolean;
	/** Whitespace between marker and content, verbatim. */
	gap: string;
	/** Offset of the first character of the cursor's line. */
	lineStart: number;
	/** Length of the full matched prefix (indent + marker + gap + checkbox). */
	prefixLen: number;
	/** Item text between the prefix and the cursor. */
	beforeCursor: string;
}

export function detectListContext(doc: string, cursor: number): ListContext | null;
export function resolveIndentUnit(doc: string, ctx: ListContext, pasted: string): string;
export function fitToList(text: string, ctx: ListContext, indentUnit: string): string;
export function fitPasteToList(text: string, doc: string, cursor: number): string;
```

`fitPasteToList` is the only thing `main.ts` calls; the other three are exported
for direct unit testing.

## Detection (F1)

```
LIST_PREFIX = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/
```

`detectListContext`:

1. `lineStart` = last `\n` before `cursor` + 1; `lineEnd` = next `\n` or EOF.
2. Match `LIST_PREFIX` against `doc.slice(lineStart, lineEnd)`; no match → `null`.
3. `cursor - lineStart >= prefixLen`, else → `null` (caret is inside the marker).
4. Reject when the cursor line's block kind is `fencedCode`, `indentedCode` or
   `frontmatter`. Determined by `segmentBlocks(doc)` and a line-number lookup —
   the same barrier set the cleanup transforms use.

A `> - item` blockquote line does **not** match (the `>` breaks the anchor) and
therefore falls through to today's behaviour — the deliberate v1 boundary.

## Algorithm (F2–F4)

Given the cleaned `text`, `ctx` and `indentUnit`:

1. `blocks = segmentBlocks(text)`, `lines = text.split("\n")`.
2. **Depth map for pasted lists.** For each maximal run of `listItem` blocks
   (blank blocks do not break the run), collect the distinct leading-whitespace
   *widths* of its marker lines, sort ascending, and map width → rank. An item's
   relative depth is its rank. This is robust to 2-space / 4-space / tab mixes
   in the source and never depends on a fixed step size (ADR-39).
3. Walk the blocks in order, appending to `out: string[]`:
   - `blank` → **skipped** (F2).
   - `paragraph` → one item line: `indent + marker() + gap + firstLine`; any
     further physical lines of the same paragraph become continuation lines at
     the content column. Sets `sawParagraphItem = true`.
   - `listItem` → for each marker line, `indent + indentUnit.repeat(nestOffset +
     depth) + <the line's own marker and text>`, where `nestOffset` is `1` when
     `sawParagraphItem` is true, else `0` (F3). Marker-less continuation lines
     inside the item keep their relative offset.
   - anything else (`fencedCode`, `tableRow`, `atxHeading`, `blockquote`,
     `thematicBreak`) → emitted verbatim, shifted to the current item's content
     column (F6).
4. `marker()` yields the context marker family: the bullet glyph, or
   `String(ordinal++) + terminator` for an ordered context, each followed by
   `"[ ] "` when `ctx.task`.
5. **First-line splice (F4).** Record the prefix length generated for `out[0]`
   and strip exactly that many characters from it; join with `\n`.
6. `fitPasteToList` prepends `" "` when `ctx.beforeCursor` is non-empty and does
   not end in whitespace.

No trailing newline is added — the caret ends at the last pasted item.

## Indent unit (F5)

`resolveIndentUnit(doc, ctx, pasted)`:

1. Scan `doc` forward and backward from the cursor's line while lines still
   belong to the same list block; return the leading whitespace of the first
   line whose indent width exceeds `ctx.indent`'s width, **verbatim**.
2. Else apply the same rank-based scan to `pasted` and return the whitespace of
   its first depth-1 item.
3. Else `"\t"` (Obsidian's own default; renders correctly at any `tabSize`).

## Pipeline placement

```
runPasteAndFormatCommand
  clipboard → applyTextCleanup("\n"+raw, recipe) → strip leading "\n"
            → fitPasteToList(text, editor.getValue(), cursorOffset)   ← NEW
            → editor.replaceSelection(...)

runPasteCommand (no-match branch only)
  clipboard → fitPasteToList(raw, op.doc, op.cursor)                  ← NEW
            → effects.rawFallback(...)
```

The script-failure `rawFallback` branch is untouched (ADR-38).

## Wiring

| File | Change |
|------|--------|
| `src/core/fitToList.ts` | **new** — the module above |
| `src/core/types.ts` | `MasonSettings.pasteListContext: boolean` + `DEFAULT_SETTINGS` entry (`true`) |
| `src/main.ts` | call in `runPasteAndFormatCommand`; call in the no-match branch of `runPasteCommand`; both gated on `settings.pasteListContext` |
| `src/ui/settingsTab.ts` | toggle in `_renderGeneralSection` — "Fit paste to list context" |
| `test/core/fitToList.test.ts` | **new** unit tests |
| `test/…paste…` | command-level tests through the existing injection seams |

`pickSettingsFields` derives its key set from `DEFAULT_SETTINGS`, so adding the
key there is sufficient for persistence; `loadSettings` already merges over
`DEFAULT_SETTINGS`, so pre-0.9 `data.json` resolves to `true`.

No registry entry and no standalone command: `fitToList` needs a clipboard and
an insertion point, which the registry's `(ctx) => EditPlan` contract does not
express (ADR-40).

## Design decisions (ADRs)

- **ADR-37 — own setting, not a `FormatSelectionRecipe` key.** The recipe
  configures the *Format selection* command's text-cleanup steps (spec 003).
  `fitToList` never runs there — it needs an insertion point. Folding it into the
  recipe would put a dead toggle in the Format selection UI and break the
  invariant that every recipe key is a `(ctx) => EditPlan` transform.
  Default **ON**: with no list context it is a provable no-op, so the
  opt-in caution that governs `reflow` does not apply.
- **ADR-38 — no-match yes, script-failure no.** The "no recognized format"
  branch is a *normal* outcome and should benefit from context fitting. The
  `rawFallback` after a script *throws* is the safe-degradation contract: it must
  stay a verbatim paste so a failure never produces a partly-restructured note.
- **ADR-39 — rank-based depth, not a fixed step.** Clipboard sources indent with
  2 spaces, 4 spaces, tabs, or non-uniform mixes. Dividing by a guessed step
  corrupts depth; ranking the distinct observed widths preserves the author's
  own hierarchy without guessing a unit.
- **ADR-40 — no registry entry / standalone command.** Every `RegistryEntry.run`
  is `(ctx: OperationContext) => EditPlan`. `fitToList` is `string → string` over
  a not-yet-inserted payload; forcing it into the registry would require a fake
  EditPlan and a second meaning for `ctx.input`. A "Fit selection to list
  context" command is listed as *Could* in the PRD and can be added later
  without touching this module.
- **ADR-41 — paragraphs adopt the context marker, pasted items keep their own.**
  A paragraph has no marker of its own, so it must borrow one; a pasted list item
  already carries authored intent (ordered vs. bullet vs. checkbox) that must
  survive the paste. `normalizeBullets` has already unified stray glyphs before
  this step runs.
- **ADR-42 — never touch the surrounding list.** `fitToList` returns only the
  inserted string. Renumbering the ordered items *below* the insertion point
  would mean editing outside the paste range, breaking the single-`replaceSelection`
  / single-undo property. The user runs "Format selection" if they want it.

## Testing (planned)

`test/core/fitToList.test.ts`, with the two verbatim TOGAF captures from
`requirements.md` as the primary fixtures, plus:

- no list context → identity (paragraph, empty doc, cursor at offset 0);
- cursor inside the marker (`-|` , `- |` boundary) → identity;
- cursor in a fenced-code line that *looks* like a list → identity;
- filled item (`- Foo|`) → space-join;
- ordered context → continuing ordinals and preserved terminator (`)` vs `.`);
- task context → `- [ ] ` on generated items, `[x]` never copied;
- clipboard starting with a list → siblings at context level, no extra indent;
- multi-level pasted list → relative depth preserved across a 2-space source and
  a tab source;
- indent unit resolved from the note, from the clipboard, and the `\t` fallback;
- fenced code inside the pasted content → emitted verbatim, never re-marked;
- idempotency: running `fitPasteToList` on its own output with the same context
  produces the same string;
- `pasteListContext: false` → identity at the command level.

Command-level coverage rides the existing `CommandInjection` seams
(`clipboardReader`, `replaceSelection`, `pasteScripts`) so no Obsidian editor is
required.
