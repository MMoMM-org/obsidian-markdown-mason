# Specification: 008-paste-list-context

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-09-02 |
| **Current Phase** | Implemented (unmerged; manual Obsidian smoke pending) |
| **Last Updated** | 2026-09-02 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | 1 must-have step (`fitToList`), 8 requirements; two verbatim TOGAF captures as reference fixtures |
| solution.md | completed | `fitPasteToList()` core module + `pasteListContext` setting (default ON); no registry entry (ADR-40) |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-09-02 | Add a paste-time list-context step | Mason's paste commands insert at the cursor without ever reading the cursor's line. Pasting into `- ` leaves the separating blank lines in place and gives paragraphs 2..n no marker, and a pasted sub-list lands at the cursor's own level instead of one below its lead-in sentence. Reproduced against the current pipeline with the user's two TOGAF captures. |
| 2026-09-02 | Model it on `cascade`, not on the cleanup transforms | `cascade()` already solves the analogous problem for headings (read context above the cursor, shift the pasted levels). This is the list-shaped twin — context in, one insertion out — not another `(ctx) => EditPlan` text cleanup. |
| 2026-09-02 | Trigger on **any** list line, not only an empty item | User decision. A filled item (`- Foo\|`) is just as common a paste target; the first pasted paragraph space-joins onto the existing text and the rest become new items. Same mechanism, wider reach. |
| 2026-09-02 | Scope: "Paste and format" + the **no-match** branch of "Paste and run scripts" | User decision. The no-match branch is a normal outcome and deserves context fitting; the script-*failure* `rawFallback` stays a verbatim paste because it is the safe-degradation contract (ADR-38). "Format selection" is excluded — no clipboard, no insertion point. |
| 2026-09-02 | Own setting `pasteListContext`, default ON | User decision. Not a `FormatSelectionRecipe` key: the recipe drives the Format selection command's cleanup steps, and a key there would render a dead toggle in that UI. Default ON is safe because the step is a provable no-op without a list context (ADR-37). |
| 2026-09-02 | Pasted lists nest under the paragraph that introduces them | The user's stated expectation for the second TOGAF capture: the lead-in sentence becomes the item, its bullets belong one level below. A clipboard that *starts* with a list has no lead-in, so those items stay siblings of the cursor's item (F3). |
| 2026-09-02 | Rank-based relative depth, no fixed indent step | Clipboard sources mix 2-space, 4-space and tab indents. Ranking the distinct observed widths preserves the author's hierarchy without guessing a unit (ADR-39). |
| 2026-09-02 | Indent unit sniffed from the note, then the clipboard, then `\t` | Obsidian's `tabSize`/`useTab` live behind config APIs that `eslint-plugin-obsidianmd` flags as unsupported. Reading the vault's actual habit out of the note itself needs no API at all (F5). |
| 2026-09-02 | Never renumber or re-indent the surrounding list | Editing outside the inserted range would break the single-`replaceSelection` / single-undo property. Pasting into the middle of an ordered list can therefore leave duplicate ordinals below; "Format selection" (`normalizeOrdered`) is the cure (ADR-42). |
| 2026-09-02 | The marker follows the LEVEL, not the origin (ADR-41 refined during implementation) | Pasted top-level items become siblings of the cursor's item, and the first one has its own marker stripped by F4 — leaving authored markers there would emit `- a` above `2. b`. Context level adopts the context marker; everything below keeps the author's own. |
| 2026-09-02 | An indented paragraph right after a list item is item BODY, not a new item | `segmentBlocks()` classifies a hard-wrapped item continuation as `paragraph`; without this rule every wrapped PDF list item would be split into two bullets. Requires full indentation + adjacency, so a genuine new paragraph is unaffected. |
| 2026-09-02 | In a task context the generated prefix OWNS the checkbox | Pasting `- [ ] a` into `- [ ] ` doubled the box — invisibly on line 1, where the note supplies the prefix. The pasted box is now consumed, and a pasted `[x]` never carries its checked state over. |
| 2026-09-02 | Implementation complete | `src/core/fitToList.ts` (`detectListContext` / `resolveIndentUnit` / `fitToList` / `fitPasteToList`) + `MasonSettings.pasteListContext` (optional, defaults true) + General settings toggle + wiring in `runPasteAndFormatCommand` and the two "no recognized format" branches of `runPasteCommand`. 47 new unit tests in `test/core/fitToList.test.ts`, 5 command tests in `main.pasteAndFormat.test.ts`, 3 in `scripts/integration.test.ts`. Full suite 1705 green; lint and typecheck clean. Docs updated (README, usage, configuration, commands-reference). |

## Context

Extends the spec-005 paste pipeline (`runPasteAndFormatCommand` → `applyTextCleanup`
→ `replaceSelection`) with the missing counterpart to spec-001's `cascade()`:
heading context is adapted on paste, list context is not. Sits *after* the
spec-004/006/007 cleanup steps in the pipeline — `dewrap` and `normalizeBullets`
have already made the clipboard unambiguous by the time `fitToList` re-segments it.

Reference inputs are two verbatim TOGAF captures supplied by the user, preserved
in `requirements.md` and planned as the primary test fixtures.

---
*This file is managed by the xdd-meta skill.*
