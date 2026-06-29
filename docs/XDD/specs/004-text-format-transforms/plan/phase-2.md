---
title: "Phase 2: Cleanup transforms"
status: completed
version: "1.0"
phase: 2
---

# Phase 2: Cleanup transforms

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Building Block View]` — `cleanup.ts` location; dependency on `markdownBlocks.ts`
- `[ref: SDD/Implementation Examples/Example 2: dewrap transform]` — `dewrap` reference implementation
- `[ref: SDD/Interface Specifications/Internal API Changes]` — `dewrap`, `dehyphenate`, `decomposeLigatures`, `tidyWhitespace` signatures
- `[ref: SDD/Complex Logic]` — dehyphenate false-positive avoidance; decompose ligatures W/VV homoglyph trap; tidyWhitespace table alignment gate
- `[ref: SDD/Risks and Technical Debt/Implementation Gotchas]` — items 5-10 (dehyphenate patterns, ligature table, table alignment, offset fusion ordering, idempotency proofs)
- `[ref: SDD/Quality Requirements]` — idempotency, markdown-safety, performance (linear in doc length)
- `[ref: PRD Feature 1 / AC]` — dewrap: paragraph joining; code/heading/list/blockquote/table/blank safety
- `[ref: PRD Feature 2 / AC]` — dehyphenate: lowercase-to-lowercase only; uppercase/digit suppression; compound hyphens; code safety; before-dewrap ordering
- `[ref: PRD Feature 3 / AC]` — decomposeLigatures: 7 canonical ligatures; curly quotes; em/en dash; ellipsis; code safety; W/w never touched
- `[ref: PRD Feature 4 / AC]` — tidyWhitespace: intra-line double-space collapse; trailing removal; 3+ blanks → 1; fenced code skip; table alignment preservation
- Existing code: `src/core/applyToString.ts` (offset model: edits carry original-doc offsets for the current scratch string, applied RTL); `src/core/noteFootnotes.ts` (`diffToEditPlan` pattern); `src/core/types.ts` (`OperationContext`, `EditPlan`)

**Key Decisions**:
- All four transforms are pure `(ctx: OperationContext) => EditPlan` functions; zero `obsidian` import (CON-2).
- Each calls `segmentBlocks(ctx.doc)` at the start to obtain block classification; code-fence and structure-typed blocks are skipped entirely.
- `dehyphenate` additionally calls `maskInlineCode(line)` before running the hyphen regex, to skip inline code spans.
- `decomposeLigatures` uses an explicit, closed enumeration of glyph → ASCII replacements; no Unicode algorithmic decomposition; W and w are never in the table.
- `tidyWhitespace` skips `"tableRow"` blocks entirely for the double-space collapse pass; trailing-space removal and blank-line squeezing are separate sub-passes.
- Each transform is idempotent: a second application to its own output returns `[]`.

**Dependencies**: Phase 1 (`segmentBlocks`, `maskInlineCode` from `markdownBlocks.ts`). `[parallel: true]` with Phase 3.

---

## Tasks

- [x] **T2.1 `dehyphenate` transform** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: Read `[ref: SDD/Interface Specifications/Internal API Changes]` for `dehyphenate` signature. Read `[ref: SDD/Complex Logic]` — "Dehyphenate false-positive avoidance" subsection: pattern `/([a-z])-\n([a-z])/`, skip fenced-code blocks via `segmentBlocks`, skip inline code spans via `maskInlineCode`. Read `[ref: SDD/Risks and Technical Debt/Implementation Gotchas]` items 5-6. Read `src/core/applyToString.ts` for the offset model.
  2. Test (RED): `test/core/cleanup.test.ts` — dehyphenate section:
     - `exam-\nple` (both sides lowercase) → joined to `example` on a single line; edit offsets are correct.
     - `PDF-\nconverter` (uppercase on left) → untouched.
     - `base-\n64` (digit on right) → untouched.
     - `well-known` (compound hyphen, no `\n`) → untouched (no match for the pattern).
     - A `-\n` pair inside a fenced code block → not joined (block-kind gate).
     - A `-\n` inside an inline code span (`` `co-\nde` ``) → not joined (maskInlineCode gate).
     - Multiple split words in one document → all joined; edit count matches word-join count.
     - Idempotency: apply `dehyphenate` twice; second pass returns `[]`.
  3. Implement (GREEN): Create `src/core/cleanup.ts` exporting `dehyphenate(ctx: OperationContext): EditPlan`. Scan the doc with `segmentBlocks`; for each line in non-fenced, non-code blocks, apply `maskInlineCode`; search for `/([a-z])-\n([a-z])/g`; emit an edit from the hyphen char through the first char of the next line, replacing with the two letters joined. Zero `obsidian` import.
  4. Validate: dehyphenate tests pass; `tsc -noEmit`; `eslint`; `grep -r "obsidian" src/core/cleanup.ts` → zero.
  - Success: lowercase-to-lowercase splits are joined; uppercase/digit/compound cases are preserved; code regions are untouched; idempotent `[ref: SDD/Interface Specifications; PRD Feature 2 / AC]`.

- [x] **T2.2 `dewrap` transform** `[activity: domain-modeling]`

  1. Prime: Read `[ref: SDD/Implementation Examples/Example 2: dewrap transform]` — reference implementation (paragraph-block iteration, `lineArr.length <= 1` guard, offset arithmetic). Read `[ref: PRD Feature 1 / AC]` — all six acceptance criteria. Read `[ref: SDD/Risks and Technical Debt/Implementation Gotchas]` item 2 (lazy list continuations — classified as `"paragraph"` by segmenter; blank-line boundary prevents merge).
  2. Test (RED): add to `test/core/cleanup.test.ts` — dewrap section:
     - Two-line paragraph → joined to single line; blank-line separator preserved.
     - Three-paragraph doc (each multi-line, separated by blanks) → each paragraph joined independently; blanks intact.
     - A fenced code block with internal line breaks → all lines untouched.
     - An ATX heading (`## Title`) adjacent to a paragraph → heading line never joined.
     - A setext heading (paragraph text + `===` underline) → neither line joined to prose above or below.
     - A list-item line adjacent to a paragraph → not joined across the list/paragraph boundary.
     - A blockquote block → none of its lines are joined to surrounding prose.
     - A table row adjacent to a paragraph → not joined.
     - Two paragraphs separated by a blank line → blank is preserved; paragraphs are not merged.
     - A single-line paragraph → `lineArr.length <= 1` → no edit emitted (idempotency entry point).
     - Idempotency: run `dewrap` on its own output → returns `[]`.
  3. Implement (GREEN): Add `dewrap(ctx: OperationContext): EditPlan` to `src/core/cleanup.ts` per the reference implementation in the SDD. Iterate only `"paragraph"` blocks from `segmentBlocks`; join with `" "`; emit one edit per block that has `>1` line.
  4. Validate: all dewrap tests pass; `tsc -noEmit`; `eslint`.
  - Success: paragraph lines joined; all structural block types (code, headings, lists, blockquotes, tables, blanks) preserved intact; idempotent `[ref: SDD/Implementation Examples/Example 2; PRD Feature 1 / AC]`.

- [x] **T2.3 `decomposeLigatures` transform** `[activity: domain-modeling]`

  1. Prime: Read `[ref: SDD/Interface Specifications/Internal API Changes]` — `decomposeLigatures` signature. Read `[ref: PRD Feature 3 / AC]` — 7 canonical ligatures (ﬁ→fi, ﬂ→fl, ﬀ→ff, ﬃ→ffi, ﬄ→ffl, æ→ae, œ→oe); curly quotes → straight; em dash → `-`; en dash → `-`; ellipsis → `...`; code safety. Read `[ref: SDD/Risks and Technical Debt/Implementation Gotchas]` item 7 — W/VV homoglyph trap: the table must never produce `W`, `VV`, `w`, or `vv` as output; `W` and `w` are never source characters.
  2. Test (RED): add to `test/core/cleanup.test.ts` — decomposeLigatures section:
     - Each of the 7 canonical ligatures individually: ﬁ→fi, ﬂ→fl, ﬀ→ff, ﬃ→ffi, ﬄ→ffl, æ→ae, œ→oe.
     - Unicode curly double quote open `"` → `"`; close `"` → `"`.
     - Unicode curly single quote open `'` → `'`; close `'` → `'`.
     - Em dash `—` → `-`; en dash `–` → `-`.
     - Ellipsis `…` → `...`.
     - A line containing ASCII `W` and `w` → untouched (homoglyph guard).
     - A line inside a fenced code block containing ligatures → untouched.
     - A line with a ligature inside an inline code span → the span is untouched (maskInlineCode guard).
     - Mixed content (ligature + plain ASCII + code span) → only the non-code ligature is replaced.
     - Idempotency: result contains only ASCII — second pass emits `[]`.
  3. Implement (GREEN): Add `decomposeLigatures(ctx: OperationContext): EditPlan` to `src/core/cleanup.ts`. Define a closed `const GLYPH_MAP: Record<string, string>` with the 14 entries (7 ligatures + 7 punctuation). Scan non-fenced-code blocks; apply `maskInlineCode` per line; replace each key from GLYPH_MAP; emit edits for changed lines. Zero `obsidian` import.
  4. Validate: all decomposeLigatures tests pass; `tsc -noEmit`; `eslint`. Manually verify the GLYPH_MAP contains no `W` or `w` output values.
  - Success: all specified glyphs are replaced; code regions are untouched; W/w are never altered; idempotent (all outputs are ASCII, which do not appear in the source map) `[ref: SDD/Interface Specifications; PRD Feature 3 / AC; SDD/Risks — homoglyph trap]`.

- [x] **T2.4 `tidyWhitespace` transform** `[activity: domain-modeling]`

  1. Prime: Read `[ref: SDD/Interface Specifications/Internal API Changes]` — `tidyWhitespace` signature. Read `[ref: PRD Feature 4 / AC]` — double-space collapse (non-leading portion); trailing whitespace removal; 3+ blank lines → 1 blank; fenced code skip; table row untouched. Read `[ref: SDD/Risks and Technical Debt/Implementation Gotchas]` item 8 — `"tableRow"` blocks must be skipped for the double-space pass.
  2. Test (RED): add to `test/core/cleanup.test.ts` — tidyWhitespace section:
     - A line with two consecutive spaces in the body → collapsed to one space.
     - A line with three or more consecutive spaces in the body → collapsed to one space.
     - Leading spaces on an indented line → preserved (only non-leading runs are collapsed).
     - A line with trailing spaces → trailing spaces removed.
     - A line with trailing tab → trailing tab removed.
     - Three consecutive blank lines → collapsed to one blank line.
     - Four consecutive blank lines → collapsed to one blank line.
     - Two consecutive blank lines → preserved as-is (only 3+ are squeezed).
     - A fenced code block with double spaces and trailing whitespace inside → untouched.
     - A markdown table row using multiple spaces for column alignment → untouched (tableRow block skip).
     - A paragraph immediately after a table → paragraph is processed; table is not.
     - Idempotency: after one pass, no double-space runs, no trailing whitespace, no 3+ blank runs remain → second pass returns `[]`.
  3. Implement (GREEN): Add `tidyWhitespace(ctx: OperationContext): EditPlan` to `src/core/cleanup.ts`. Three sub-passes (all operating on non-fenced-code blocks): (1) per-line double-space collapse — skip `"tableRow"` blocks; apply `/  +/g → " "` only to the non-leading portion; (2) per-line trailing whitespace — apply `/[ \t]+$/`; (3) blank-line squeeze — use segmentBlocks to find `"blank"` runs of 3+ consecutive single-blank-blocks and collapse to one. Merge all edits into one `EditPlan`. Zero `obsidian` import.
  4. Validate: all tidyWhitespace tests pass; `tsc -noEmit`; `eslint`.
  - Success: double spaces collapsed; trailing whitespace removed; 3+ blank runs squeezed; fenced code and table rows untouched; idempotent `[ref: SDD/Interface Specifications; PRD Feature 4 / AC; SDD/Risks — table alignment]`.

## Phase Validation

- `npx vitest run` green for all cleanup tests (dehyphenate + dewrap + decomposeLigatures + tidyWhitespace).
- `npx tsc -noEmit -skipLibCheck`; `npx eslint src/` — both clean.
- `grep -r "obsidian" src/core/cleanup.ts` → zero matches (CON-2).
- Idempotency tests pass for all four transforms.
- Markdown-structure fixture tests: every structural block type (fenced code, indented code, heading, list, blockquote, table, thematic break, frontmatter) survives all four transforms byte-identical.
