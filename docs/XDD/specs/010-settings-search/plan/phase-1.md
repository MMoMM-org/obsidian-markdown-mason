---
title: "Phase 1: Foundations: test harness, storage adapter, fixed definitions"
status: completed
version: "1.0"
phase: 1
---

# Phase 1: Foundations: test harness, storage adapter, fixed definitions

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Building Block View/Components]`: responsibility table
- `[ref: SDD/Interface Specifications/Internal API Changes]`: settingsControlStore, settingsDefinitions, pluginIdentity signatures
- `[ref: SDD/Application Data Models]`: FixedSettingSpec and the main-page tree
- `[ref: SDD/Implementation Examples/Control-key resolution with nested Format selection]`: traced walkthrough
- `[ref: SDD/Implementation Gotchas]`

**Key Decisions**:
- ADR-5: control keys `FixedKey` incl. dotted `formatSelection.*`; defaults read through `DEFAULT_SETTINGS` / `resolveFormatSelectionRecipe` only.
- ADR-2: Format selection = umbrella group with the intro row, then 4 sibling groups.
- ADR-3: Documentation action row closes Advanced.
- ADR-8: pure builders, definition-level tests.

**Dependencies**: none (first phase). Everything here is additive; the existing segmented tab keeps working.

---

## Tasks

Establishes the test harness for the declarative API, the single source of truth for the 18 fixed settings, and the storage adapter that keeps `data.json` intact.

- [x] **T1.1 Declarative-API test harness** `[activity: test-infrastructure]` `[parallel: true]`

  1. Prime: Read the mock `Setting`/`PluginSettingTab` (test/__mocks__/obsidian.ts ~L630-834) and the 1.13 members in obsidian.d.ts `[ref: SDD/Implementation Gotchas]` `[ref: SDD/Test Examples as Interface Documentation]`
  2. Test: Harness self-tests:
     - mock `PluginSettingTab.update()` stores `settingItems = getSettingDefinitions()` and counts calls;
     - `refreshDomState()` and `hide()` exist;
     - the base `getControlValue`/`setControlValue` **throw**;
     - mock `Setting` exposes `nameEl`/`descEl`/`controlEl`/`settingEl`, `addExtraButton` (with `setIcon`/`setTooltip`/`onClick`/`extraSettingsEl`), `setDisabled`, `setTooltip`;
     - a `SettingGroup` stub can be constructed;
     - a `walk(items)` test helper flattens a definition tree into `{path, type, name, key, desc, aliases}` (no `id`, deviation D-1) in render order, recursing through groups, lists and pages.
  3. Implement: Extend `test/__mocks__/obsidian.ts` (additive; existing captures unchanged). Add `test/ui/helpers/definitionTree.ts` with `walk()`.
  4. Validate: Full suite still green (existing UI tests untouched); `tsc -noEmit` clean (vitest 4 `Mock<…>` typing).
  5. Success: The throwing base setter makes any missing override fail loudly `[ref: SDD/ADR-5]`; the tree walker supports every definition kind used by the SDD `[ref: SDD/Application Data Models]`

- [x] **T1.2 Storage adapter: settingsControlStore** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: `[ref: SDD/Implementation Examples/Control-key resolution with nested Format selection]`; src/core/types.ts (`MasonSettings`, `DEFAULT_SETTINGS`); src/core/formatSelection.ts (`resolveFormatSelectionRecipe`)
  2. Test:
     - `isFixedKey` accepts the 18 keys and rejects others (`"bogus"`, `"formatSelection."`, `"scripts"`);
     - `readControl` follows every row of the SDD traced walkthrough (stored flat, missing flat → default, stored nested, missing nested → recipe default incl. `reflow` false);
     - `writeControl` writes flat keys, creates `formatSelection` when absent, and merges into an existing one without dropping siblings;
     - no other fields are touched.
  3. Implement: Create `src/ui/settingsControlStore.ts` (`FixedKey`, `isFixedKey`, `readControl`, `writeControl`). Pure, no I/O, no `obsidian` runtime import.
  4. Validate: Unit tests pass; lint clean; types check.
  5. Success: Defaults identical to today's for a fresh install `[ref: PRD/F3.2]`; stored 0.9.4 values reported unchanged `[ref: PRD/F3.1]`; SDD criteria "missing key → defaults" and "unknown key → no mutation" `[ref: SDD/Acceptance Criteria/Behaviour parity]`

- [x] **T1.3 Documentation row: pluginIdentity** `[activity: frontend-ui]` `[parallel: true]`

  1. Prime: src/ui/HeaderSection.ts (`REPO_URL` L19, author parsing L98-104), test/ui/headerSection.test.ts `[ref: SDD/ADR-3]`
  2. Test:
     - `buildDocumentationRow(manifest)` returns an action definition named "Documentation";
     - its desc contains `v{version}` and the parsed author name (the email is stripped; a missing author is handled);
     - aliases include `help` and `version`;
     - `action()` opens `REPO_URL`;
     - hostile manifest strings stay plain strings;
     - text is in sentence case.
  3. Implement: Create `src/ui/pluginIdentity.ts`. Move `REPO_URL` and the author-name parsing here; leave HeaderSection.ts importing them until T3.1 deletes it.
  4. Validate: Unit tests pass; headerSection tests still pass; lint and types clean.
  5. Success: Version and Documentation link reachable without a heading above General `[ref: PRD/F9.1]`; SDD identity criterion `[ref: SDD/Acceptance Criteria/Identity]`

- [x] **T1.4 Fixed settings SSOT and main-page tree: settingsDefinitions** `[activity: frontend-ui]`

  Depends on T1.1, T1.2, T1.3.

  1. Prime: Today's strings in src/ui/settingsTab.ts (L233-294, L521-707 incl. `FORMAT_SELECTION_ONLY` L521, L716-728) `[ref: SDD/Application Data Models]` `[ref: SDD/ADR-2]`; aliases list `[ref: SDD/Acceptance Criteria/Fixed settings and search]`
  2. Test (via `walk()`):
     - exactly 18 controls with today's names and descs verbatim, each bound to the right `FixedKey` and control type (text with placeholder "## Resources" for resourcesName, toggles otherwise);
     - main-page order: 4 bare General controls, then the injected Scripts page, then the injected Commands page, then the Format selection group with the intro row "Which steps run" (today's intro desc), then Cleanup (6), Lists (2), Headings (2), Footnotes (3), then Advanced (Debug logging, then the injected Documentation row);
     - the "Format selection only" suffix is on exactly cascade, fromCitations, identity and move;
     - aliases: OCR and TextSniper → reflow; footnotes → Resolve footnote identity (added in T1.6); paste and paste and format → intro; console and debug → Debug logging; no alias appears on two targets;
     - every name, desc, heading and alias is in sentence case (tree-walking check, because lint can't see object literals);
     - the result is never empty.
  3. Implement: Create `src/ui/settingsDefinitions.ts` with `FIXED_SETTINGS` (one `FixedSettingSpec` per setting) and `buildMainPageItems({scriptsPage, commandsPage, identityRow})`. Pages and the identity row are injected, so the module has no dependency on the scripts code.
  4. Validate: Unit tests pass; lint and types clean; no string is duplicated between this file and the still-live settingsTab.ts. The old tab reads its strings from here (deviation D-2), so each string exists once; T3.1 deletes the old tab.
  5. Success:
     - [x] All 18 settings findable by name or desc `[ref: PRD/F1.1]` `[ref: PRD/F1.2]`
     - [x] Layout order and headings `[ref: PRD/F2.1]` `[ref: PRD/F2.2]`
     - [x] "Format selection only" note kept `[ref: PRD/F2.3]`
     - [x] Sentence case `[ref: PRD/F2.4]`
     - [x] Everyday-word aliases for fixed settings `[ref: PRD/F8.1]` `[ref: PRD/F8.2]`

- [x] **T1.6 Search reach and noise for fixed settings** `[activity: frontend-ui]`

  Added by the Phase 1 drift check (2026-11-21): the PRD's search-by-description and no-noise criteria had no test.

  1. Prime: PRD Feature 1.2 and Feature 8 `[ref: PRD/F1.2]` `[ref: PRD/F8.1]` `[ref: PRD/F8.2]`; Obsidian matches a row by name, desc text and each alias (simple substring search) `[ref: SDD/Constraints]`; test/ui/settingsDefinitions.test.ts
  2. Test:
     - a test-only `search(items, term)` helper returns the names of rows whose name, desc or any alias contains the term (case-insensitive), walking the whole tree;
     - description words reach their target: "ligature" → Decompose ligatures and punctuation, "OCR" → Reflow wrapped text;
     - each Feature 8 word returns exactly a pinned result set (OCR, TextSniper, paste, footnotes, console, debug);
     - known overlaps are pinned as related, not noise: "OCR" also matches Dehyphenate words (OCR artifacts), "paste" also matches the four "Format selection only" toggles through their suffix;
     - no fixed-settings search word returns an unrelated row.
  3. Implement: the helper in `test/ui/helpers/definitionTree.ts` next to `walk()`, and the tests in `test/ui/settingsDefinitions.test.ts`. Change production text only if a pinned result reveals real noise; record any such change.
  4. Validate: tests pass; tsc and lint clean.
  5. Success: search by description `[ref: PRD/F1.2]`; everyday words reach their target `[ref: PRD/F8.1]`; no unrelated noise `[ref: PRD/F8.2]`

- [x] **T1.5 Phase validation** `[activity: validate]`

  Run `npx tsc -noEmit -skipLibCheck && npm run lint && npm test`. Remove the `id` surface (`idOf`, `withId`, `DefinitionNode.id` and its assertions) from test/ui/helpers/definitionTree.ts and harness.test.ts per deviation D-1. Verify the new modules against the SDD responsibility table (each owns exactly one responsibility; no ordering logic outside `buildMainPageItems`). The existing segmented tab and its tests still pass unchanged.
