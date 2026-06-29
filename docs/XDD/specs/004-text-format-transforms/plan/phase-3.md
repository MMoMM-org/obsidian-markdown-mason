---
title: "Phase 3: List transforms"
status: completed
version: "1.0"
phase: 3
---

# Phase 3: List transforms

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Building Block View]` — `lists.ts` location; dependency on `markdownBlocks.ts`
- `[ref: SDD/Interface Specifications/Internal API Changes]` — `normalizeBullets`, `normalizeOrdered` signatures
- `[ref: SDD/Complex Logic]` — "normalizeOrdered nesting": indent-stack algorithm (`(indentWidth, counter)` pairs), level push/pop, `/^\s*\d+[.)]/` target restriction, alphabetic/roman-numeral untouched
- `[ref: SDD/Quality Requirements]` — idempotency, markdown-safety, performance
- `[ref: PRD Feature 5 / AC]` — normalizeBullets: `*`, `+`, `•`, `–`, `·` → `-`; nesting preserved; checkboxes preserved; ordered lists untouched; mid-sentence characters untouched
- `[ref: PRD Feature 6 / AC]` — normalizeOrdered: sequential renumbering per nesting level; loose lists preserved; alphabetic/roman untouched; bullet lists untouched
- Existing code: `src/core/types.ts` (`OperationContext`, `EditPlan`); `src/core/applyToString.ts` (offset model); `src/core/markdownBlocks.ts` (Phase 1 output — `segmentBlocks`, `BlockKind`, `Block`)

**Key Decisions**:
- Both transforms are pure `(ctx: OperationContext) => EditPlan` functions; zero `obsidian` import (CON-2).
- `normalizeBullets` targets only line-start markers matched by the `segmentBlocks` `"listItem"` classification using `/^\s*([-*+•–·]|\d+[.)]) /` — replacing only the leading non-`-` bullet character, not any occurrence mid-line.
- `normalizeBullets` explicitly excludes ordered-list lines (`/^\s*\d+[.)]/ `) and preserves checkbox syntax (`- [ ]`, `- [x]`) verbatim.
- `normalizeOrdered` uses a stack-based per-nesting-level counter. Only `/^\s*\d+[.)]/` lines are renumbered; alpha (`a.`) and roman-numeral (`i.`) markers are skipped entirely.
- Blank lines between loose list items are preserved in their current positions; only the numeric marker changes.

**Dependencies**: Phase 1 (`segmentBlocks` from `markdownBlocks.ts`). `[parallel: true]` with Phase 2.

---

## Tasks

- [x] **T3.1 `normalizeBullets` transform** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: Read `[ref: SDD/Interface Specifications/Internal API Changes]` — `normalizeBullets` signature and specification. Read `[ref: PRD Feature 5 / AC]` — all five acceptance criteria. Read `[ref: SDD/Building Block View/Components]` — note that `segmentBlocks` classifies list items using `/^\s*([-*+•–·]|\d+[.)]) /`. Understand the constraint: only line-start markers are targeted; the replacement is the leading non-`-` glyph, not any character mid-line.
  2. Test (RED): `test/core/lists.test.ts` — normalizeBullets section:
     - A `*` bullet list → all markers replaced with `-`; item text unchanged.
     - A `+` bullet list → all markers replaced with `-`.
     - A `•` bullet list → all markers replaced with `-`.
     - A `–` bullet list → all markers replaced with `-`.
     - A `·` bullet list → all markers replaced with `-`.
     - A nested bullet list (two indentation levels, mixed markers) → all markers at all levels replaced with `-`; indentation of each level is preserved exactly (character count unchanged except the marker glyph itself).
     - A task-list item `- [ ] task` → unchanged (marker is already `-`; checkbox syntax intact).
     - A task-list item `* [x] done` → marker changed to `-`; checkbox `[x]` is preserved: `- [x] done`.
     - An ordered list (`1. item`) → untouched.
     - A mixed doc (bullet list + ordered list + paragraph) → only bullet markers changed; ordered list and paragraph untouched.
     - Item text containing a mid-sentence bullet-like character (e.g. `buy milk • eggs`) → mid-sentence `•` is not rewritten; only the line-start marker is replaced.
     - Idempotency: a doc already using `-` for all bullets → `normalizeBullets` returns `[]`.
  3. Implement (GREEN): Create `src/core/lists.ts` exporting `normalizeBullets(ctx: OperationContext): EditPlan`. Iterate `segmentBlocks(ctx.doc)` blocks of kind `"listItem"`. For each line in those blocks, detect the leading marker with `/^(\s*)([-*+•–·])( |\t)/`. If the marker character is not `-`, emit an edit that replaces only that marker character. Skip lines where the marker is already `-`. Zero `obsidian` import.
  4. Validate: all normalizeBullets tests pass; `tsc -noEmit`; `eslint`; `grep -r "obsidian" src/core/lists.ts` → zero.
  - Success: all non-`-` bullet markers normalized to `-`; nesting and checkbox syntax preserved; ordered lists untouched; mid-sentence characters untouched; idempotent `[ref: SDD/Interface Specifications; PRD Feature 5 / AC]`.

- [x] **T3.2 `normalizeOrdered` transform** `[activity: domain-modeling]`

  1. Prime: Read `[ref: SDD/Interface Specifications/Internal API Changes]` — `normalizeOrdered` signature. Read `[ref: SDD/Complex Logic]` — "normalizeOrdered nesting" subsection: indent-stack algorithm, counter reset on level-push, counter increment on same-level item, level pop on indent decrease. Read `[ref: PRD Feature 6 / AC]` — all five acceptance criteria. Read `[ref: SDD/Risks and Technical Debt/Implementation Gotchas]` item — "normalizeOrdered drops or merges nesting levels if indentation parsing is incorrect" (mitigate with per-level fixtures at 2 and 3 levels; preserve loose/tight structure).
  2. Test (RED): add to `test/core/lists.test.ts` — normalizeOrdered section:
     - A flat ordered list `3. 1. 7.` → renumbered to `1. 2. 3.`.
     - A flat list that is already sequential `1. 2. 3.` → returns `[]` (idempotency).
     - A nested ordered list (2 indentation levels, out-of-sequence numbers) → each level renumbered independently from 1; indentation preserved.
     - A nested ordered list (3 indentation levels) → each level renumbered independently; correct counter per level.
     - A loose ordered list (blank lines between items) → blank lines preserved in position; only numbers change.
     - A list using alphabetic markers (`a. b. c.`) → untouched.
     - A list using roman-numeral markers (`i. ii. iii.`) → untouched.
     - A bullet list → untouched.
     - A mixed doc (ordered list + bullet list + paragraph) → only ordered list renumbered; rest untouched.
     - Period terminator (`1.`) and parenthesis terminator (`1)`) → both handled; terminator style preserved (`.` or `)` as-is per item).
     - Idempotency: run `normalizeOrdered` on its own output → returns `[]`.
  3. Implement (GREEN): Add `normalizeOrdered(ctx: OperationContext): EditPlan` to `src/core/lists.ts`. Scan `segmentBlocks(ctx.doc)` for `"listItem"` lines matching `/^(\s*)(\d+)([.)])/`. Maintain a stack of `{ indent: number; counter: number }`. For each match: if indent > stack top → push new level with `counter: 1`; if indent < stack top → pop until matching indent, then increment; if indent === stack top → increment. Emit an edit replacing the digit(s) with the new counter if changed. Skip any `"listItem"` lines that do not match the numeric pattern (bullet and alpha/roman items). Zero `obsidian` import.
  4. Validate: all normalizeOrdered tests pass; `tsc -noEmit`; `eslint`.
  - Success: non-sequential ordered lists renumbered correctly per nesting level; loose list structure preserved; alphabetic/roman/bullet lists untouched; idempotent `[ref: SDD/Interface Specifications; SDD/Complex Logic; PRD Feature 6 / AC]`.

## Phase Validation

- `npx vitest run` green for all list tests (normalizeBullets + normalizeOrdered).
- `npx tsc -noEmit -skipLibCheck`; `npx eslint src/` — both clean.
- `grep -r "obsidian" src/core/lists.ts` → zero matches (CON-2).
- Idempotency tests pass for both transforms.
- Nesting fixture at 3 levels passes for both normalizeBullets (marker replacement) and normalizeOrdered (per-level counter).
- Loose list blank-line preservation passes for normalizeOrdered.
