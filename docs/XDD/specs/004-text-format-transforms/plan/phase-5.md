---
title: "Phase 5: Settings UI"
status: completed
version: "1.0"
phase: 5
---

# Phase 5: Settings UI

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Cross-Cutting Concepts/User Interface & UX]` — wireframe; four `setHeading` sub-groups (Cleanup / Lists / Headings / Footnotes); toggle copy (sentence-case names + effect descriptions); `onChange` pattern; UI order vs execution order note
- `[ref: SDD/ADR-23]` — `setHeading` sub-groups in settings; four calls; standard supported Obsidian API; AT-friendly; no custom DOM
- `[ref: SDD/Interface Specifications/Internal API Changes]` — `resolveFormatSelectionRecipe` receives `MasonSettings` and returns a fully-resolved 11-key `FormatSelectionRecipe`
- `[ref: SDD/CON-3]` — `setHeading()` is a standard, supported Obsidian `Setting` method (not Catalyst-beta); `addToggle` pattern; no `removeCommand`; no unsupported-API surface
- `[ref: PRD Should Have Features]` — 11 toggles in labeled sub-groups; `setDesc` sentence per toggle
- Existing code: `src/ui/settingsTab.ts` — `_renderFormatSelectionSection` (the existing 5-toggle implementation); `Segment` union (`:57`), `SEGMENTS` array (`:59`), `_renderSegment` switch (`:206`); `addToggle(t => t.setValue(...).onChange(...))` write pattern; `saveSettings` usage; comment at line 69 confirming `setHeading` convention

**Key Decisions**:
- `_renderFormatSelectionSection` replaces the flat 5-toggle layout with 4 `setHeading` sub-groups each followed by their toggles: Cleanup (dewrap, dehyphenate, decomposeLigatures, tidyWhitespace), Lists (normalizeBullets, normalizeOrdered), Headings (cascade, normalize), Footnotes (fromCitations, identity, move).
- Toggle values are read via `resolveFormatSelectionRecipe(this._plugin.settings)` — uses the resolver, not a raw field read, so absent stored keys correctly default to `true`.
- Each `onChange` initializes `this._plugin.settings.formatSelection` if absent, sets the key, then calls `await this._plugin.saveSettings()`. Identical pattern to the existing 5 toggles.
- UI order within Cleanup group (dewrap, dehyphenate, decomposeLigatures, tidyWhitespace) is for conceptual clarity; it differs from execution order (dehyphenate → dewrap → tidyWhitespace → decomposeLigatures). The `setDesc` for "Dehyphenate words" notes it runs before dewrap.
- No re-registration is needed when toggles change — `fusedFormatNote` reads settings fresh per run.
- The "Format selection" segment nav entry already exists from spec 003. Only `_renderFormatSelectionSection` changes.

**Dependencies**: Phase 1 (extended `FormatSelectionRecipe` type — `resolveFormatSelectionRecipe` now returns 11 keys). `[parallel: true]` with Phase 4.

---

## Tasks

- [x] **T5.1 Grow `_renderFormatSelectionSection` to 11 toggles with four `setHeading` sub-groups** `[activity: build-feature]`

  1. Prime: Read `src/ui/settingsTab.ts` in full — find `_renderFormatSelectionSection`, the `addToggle` write pattern, `saveSettings`, and the `Segment` plumbing. Read `[ref: SDD/Cross-Cutting Concepts/User Interface & UX]` — the wireframe showing group labels, toggle names (sentence-case), and `setDesc` descriptions. Read `[ref: SDD/ADR-23]` for `setHeading` usage pattern: `new Setting(containerEl).setName("Cleanup").setHeading()`. Read `[ref: SDD/CON-3]` confirming `setHeading` is a supported, standard Obsidian API. Note the `onChange` pattern from the SDD Cross-Cutting section: initialize `formatSelection` if absent, set field, call `saveSettings`.
  2. Test (RED): a settings-tab test (mirroring the existing settings-tab test structure):
     - Rendering `_renderFormatSelectionSection` produces 11 toggle elements (4 Cleanup + 2 Lists + 2 Headings + 3 Footnotes).
     - Four `setHeading` group labels are rendered in order: "Cleanup", "Lists", "Headings", "Footnotes".
     - Initial toggle values reflect `resolveFormatSelectionRecipe(settings)` — i.e., absent stored keys default to `true`.
     - `onChange` for `dewrap` toggle: sets `settings.formatSelection.dewrap` and calls `saveSettings`; if `settings.formatSelection` was absent, it is initialized before the field is set.
     - `onChange` for each of the 5 remaining new keys (`dehyphenate`, `decomposeLigatures`, `tidyWhitespace`, `normalizeBullets`, `normalizeOrdered`) persists correctly (one test per key, or a parameterized sweep).
     - Existing 5 toggle keys (`cascade`, `normalize`, `fromCitations`, `identity`, `move`) still persist correctly (regression check — their `onChange` handlers are unchanged in behavior).
     - The "Format selection" segment nav entry is still present and routes to this section.
  3. Implement (GREEN): In `src/ui/settingsTab.ts`, replace the body of `_renderFormatSelectionSection` — keep the intro `Setting` (if any); then insert four `setHeading` calls each followed by their group's toggles:
     - `new Setting(containerEl).setName("Cleanup").setHeading()` → then 4 addToggle rows for dewrap / dehyphenate / decomposeLigatures / tidyWhitespace (sentence-case names + effect `setDesc`).
     - `new Setting(containerEl).setName("Lists").setHeading()` → then 2 addToggle rows for normalizeBullets / normalizeOrdered.
     - `new Setting(containerEl).setName("Headings").setHeading()` → then 2 addToggle rows for cascade / normalize (existing, moved under heading).
     - `new Setting(containerEl).setName("Footnotes").setHeading()` → then 3 addToggle rows for fromCitations / identity / move (existing, moved under heading).
     Each toggle reads `resolveFormatSelectionRecipe(this._plugin.settings).<key>` for its value and writes to `this._plugin.settings.formatSelection.<key>` in its `onChange`. No changes to the `Segment` union, `SEGMENTS` array, or `_renderSegment` switch (the "Format selection" case already exists from spec 003).
  4. Validate: settings-tab tests pass; `tsc -noEmit`; `eslint`. Visual check that the 11 toggles appear in the correct sub-groups with sentence-case labels and accurate effect descriptions.
  - Success: 11 toggles render under 4 `setHeading` groups; values reflect `resolveFormatSelectionRecipe`; all 11 persist via `saveSettings`; nav unchanged; no unsupported API introduced (CON-3) `[ref: SDD/Cross-Cutting Concepts/User Interface & UX; SDD/ADR-23; PRD Should Have Features]`.

## Phase Validation

- `npx vitest run` green for all settings-tab tests.
- `npx tsc -noEmit -skipLibCheck`; `npx eslint src/` — both clean.
- 11 toggles render under 4 labeled sub-groups: Cleanup (4), Lists (2), Headings (2), Footnotes (3).
- Absent stored `formatSelection` keys default to `true` via the resolver (not a raw field read).
- All 11 `onChange` handlers persist to `settings.formatSelection` and call `saveSettings`.
- No `removeCommand`, no Catalyst-beta fields, no custom DOM construction (CON-3 compliant).
