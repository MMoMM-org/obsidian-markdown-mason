---
title: "Phase 1: Pure core foundations"
status: pending
version: "1.0"
phase: 1
---

# Phase 1: Pure core foundations

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Building Block View]` — directory map; three new core modules
- `[ref: SDD/Implementation Examples/Example 1: Block segmenter]` — `segmentBlocks` + `maskInlineCode` full implementation
- `[ref: SDD/Interface Specifications/Internal API Changes]` — `BlockKind`, `Block`, `segmentBlocks`, `maskInlineCode` signatures
- `[ref: SDD/Interface Specifications/Data Storage Changes]` — `FormatSelectionRecipe` 11-field shape; `DEFAULT_SETTINGS` additions
- `[ref: SDD/Implementation Examples/Example 3: Extended FormatSelectionRecipe and resolver]` — resolver with `?? true` for all 11 keys
- `[ref: SDD/ADR-20]` — custom line-based segmenter rationale; detection priority order
- `[ref: SDD/ADR-22]` — flat recipe keys; `markdownBlocks.ts` as shared utility
- `[ref: SDD/Risks and Technical Debt/Implementation Gotchas]` — nested fences, setext ambiguity, frontmatter boundary, lazy continuations
- `[ref: PRD Feature 7 / AC]` — default-on / missing-means-on; idempotency; byte-identity regression
- Existing code: `src/core/types.ts` (`MasonSettings`, `DEFAULT_SETTINGS`, `OperationContext`, `EditPlan`);
  `src/core/formatSelection.ts` (`FormatSelectionRecipe`, `resolveFormatSelectionRecipe`);
  `src/core/applyToString.ts` (offset model reference)

**Key Decisions**:
- `segmentBlocks` uses a single top-to-bottom line scan with a two-phase design (classify then group). Detection priority is fixed (fenced code and frontmatter highest; setext uses one-step look-back retroactive reclassification). No AST parser. CON-2 purity mandatory (ADR-20).
- `FormatSelectionRecipe` gains 6 flat boolean keys; `resolveFormatSelectionRecipe` gets 6 new `?? true` branches. Missing stored fields resolve to `true` — backward-compatible with all existing persisted data (ADR-22).
- `DEFAULT_SETTINGS.formatSelection` gains 6 new `true` entries matching the new recipe fields.
- Everything in this phase is pure — zero `obsidian` imports in any new file.

**Dependencies**: none — this is the spine. Phases 2, 3, and 5 build on it.

---

## Tasks

- [ ] **T1.1 `src/core/markdownBlocks.ts` — block segmenter + inline-code masking** `[activity: domain-modeling]`

  1. Prime: Read `[ref: SDD/Implementation Examples/Example 1: Block segmenter]` in full (the complete implementation is given). Read `[ref: SDD/Interface Specifications/Internal API Changes]` for the `BlockKind` union, `Block` interface, and `segmentBlocks`/`maskInlineCode` signatures. Read `[ref: SDD/ADR-20]` for detection priority order. Read `[ref: SDD/Risks and Technical Debt/Implementation Gotchas]` items 1-4 (nested fences, lazy continuations, setext/thematic-break ambiguity, frontmatter boundary).
  2. Test (RED): `test/core/markdownBlocks.test.ts` — write tests before the file exists:
     - `segmentBlocks` classifies each `BlockKind` correctly on a minimal fixture per kind: `paragraph`, `atxHeading` (all six levels), `setextHeading` (both `=` and `-` underlines), `fencedCode` (backtick and tilde; open and close fence lines both classified as `"fencedCode"`), `indentedCode` (four-space prefix), `blockquote`, `listItem` (all five markers: `-`, `*`, `+`, `•`, `–`; also ordered `1.` and `1)`), `tableRow`, `thematicBreak`, `frontmatter` (must be at line 0), `blank`.
     - Edge cases: nested fence (backtick fence inside a blockquote `> ``` ` is classified `"blockquote"`, not `"fencedCode"`); a `---` line following a `"paragraph"` line → both classified `"setextHeading"` (not `"thematicBreak"`); a `---` line following a `"blank"` or any non-paragraph line → `"thematicBreak"`; frontmatter requires `i === 0` strictly (a `---` at line 3 is not frontmatter); a lazy list continuation line (indented prose after a list item) is classified `"paragraph"` by the segmenter (not `"listItem"`); a tilde fence closes only with a matching tilde fence of >= same length.
     - `Block` objects: `startLine`, `endLine`, `startOffset`, `endOffset` are correct for multi-line blocks (verify offset arithmetic for a two-paragraph doc with a blank separator).
     - `maskInlineCode`: `` `code` `` content is replaced with `\0` chars of equal length; the surrounding backticks are preserved; double-backtick spans `` `` `code` `` `` are masked; a line with no code spans is returned unchanged; ligature characters inside a code span are replaced (masking happens at the char level before any transform regex).
  3. Implement (GREEN): Create `src/core/markdownBlocks.ts` per the SDD Example 1 reference implementation. Export `BlockKind`, `Block`, `segmentBlocks`, `maskInlineCode`. Zero `obsidian` imports.
  4. Validate: unit tests pass; `npx tsc -noEmit -skipLibCheck`; `npx eslint src/`; compliance: `grep -r "obsidian" src/core/markdownBlocks.ts` → no output.
  - Success: every block kind is correctly classified including all edge cases; offset arithmetic is correct; inline-code masking produces equal-length null-char replacements `[ref: SDD/Building Block View; SDD/ADR-20; PRD Feature 7 / AC — markdown-structure preservation]`.

- [ ] **T1.2 Extend `FormatSelectionRecipe` to 11 keys + update `resolveFormatSelectionRecipe`** `[activity: data-architecture]`

  1. Prime: Read `src/core/formatSelection.ts` (existing `FormatSelectionRecipe` — 5 fields; existing `resolveFormatSelectionRecipe`). Read `[ref: SDD/Implementation Examples/Example 3]` for the full 11-field interface and resolver. Read `[ref: SDD/Interface Specifications/Data Storage Changes]` for the exact field names: `dewrap`, `dehyphenate`, `decomposeLigatures`, `tidyWhitespace`, `normalizeBullets`, `normalizeOrdered`.
  2. Test (RED): extend `test/core/formatSelection.test.ts`:
     - `resolveFormatSelectionRecipe({})` returns all 11 fields `true` (5 existing + 6 new).
     - A partial object with each new key explicitly `false` → that key is `false`, remaining 10 are `true`.
     - All-explicit-false object → all 11 keys are `false` (explicit value respected over `?? true`).
     - Returned object has exactly 11 keys (no extras; no missing).
     - Existing five-key behavior is unchanged: a partial `{ move: false }` still resolves `move: false` and all other 10 `true`.
  3. Implement (GREEN): Modify `src/core/formatSelection.ts` — add 6 boolean fields to `FormatSelectionRecipe` interface; add 6 `?? true` resolutions to `resolveFormatSelectionRecipe`, each following the existing pattern exactly. No `obsidian` import; no other changes.
  4. Validate: tests pass; `tsc -noEmit`; `eslint`. Confirm existing resolver behavior for the 5 spec-003 keys is byte-identical.
  - Success: missing/partial stored data resolves to all-on for all 11 fields; explicit values override defaults; zero regression on spec-003 keys `[ref: SDD/Interface Specifications/Data Storage Changes; SDD/Implementation Examples/Example 3; PRD Feature 7 / AC — default-on]`.

- [ ] **T1.3 `DEFAULT_SETTINGS.formatSelection` — add 6 new true entries** `[activity: data-architecture]`

  1. Prime: Read `src/core/types.ts` — `MasonSettings`, `DEFAULT_SETTINGS`, `DEFAULT_SETTINGS.formatSelection` (5 existing true entries). Import constraint: `FormatSelectionRecipe` is already imported from `src/core/formatSelection.ts`; the type of `formatSelection` is `Partial<FormatSelectionRecipe>` — shape is unchanged, only the concrete defaults object grows.
  2. Test (RED): extend the types/defaults test (or create `test/core/types.test.ts` if none exists):
     - `DEFAULT_SETTINGS.formatSelection` has exactly 11 keys, each `true`.
     - Adding the six new keys does not break the TypeScript compiler (the `Partial<FormatSelectionRecipe>` constraint accepts all 11 when the interface has 11 fields — T1.2 is a prerequisite).
     - Snapshot or explicit key-by-key assertion to prevent silent regression if a field is removed.
  3. Implement (GREEN): In `src/core/types.ts`, add `dewrap: true, dehyphenate: true, decomposeLigatures: true, tidyWhitespace: true, normalizeBullets: true, normalizeOrdered: true` to `DEFAULT_SETTINGS.formatSelection`. No other changes. No `obsidian` import in this section; the file already carries the plugin import, but the `DEFAULT_SETTINGS` object itself is pure data.
  4. Validate: tests pass; `tsc -noEmit`; `eslint`. Confirm existing 5 entries are still present and true.
  - Success: fresh install defaults to all 11 true; older persisted data missing the new keys resolves to all-on via T1.2 resolver `[ref: SDD/Interface Specifications/Data Storage Changes; PRD Feature 7 / AC — default-on / behavior-preserving default]`.

## Phase Validation

- `npx tsc -noEmit -skipLibCheck`, `npx eslint src/`, `npx vitest run` all pass.
- `grep -r "obsidian" src/core/markdownBlocks.ts` → zero matches (CON-2).
- `resolveFormatSelectionRecipe({})` returns all 11 `true`.
- `DEFAULT_SETTINGS.formatSelection` has 11 keys all `true`.
- All segmenter edge cases (nested fence, setext/thematic ambiguity, frontmatter boundary, lazy continuation) covered by passing tests.
